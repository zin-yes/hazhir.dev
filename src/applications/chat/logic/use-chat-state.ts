"use client";

import Peer, { DataConnection } from "peerjs";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/auth/client";
import { trpc } from "@/lib/trpc/client";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type PeerMessage =
  | {
      type: "chat";
      messageId: string;
      senderId: string;
      senderName: string;
      content: string;
      timestamp: number;
    }
  | {
      type: "typing";
      senderId: string;
      isTyping: boolean;
    }
  | {
      type: "presence";
      senderId: string;
      online: boolean;
    };

export type LocalMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  senderName: string | null;
  content: string;
  createdAt: string;
};

export type ActiveView = "friends" | "chat";

export type FriendEntry = {
  id: string;
  userId: string;
  friendId: string;
  friendName: string | null;
  friendEmail: string;
  status: string;
};

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const MAXIMUM_PEER_RECONNECT_ATTEMPTS = 5;
const TYPING_INDICATOR_CLEAR_DELAY_MILLISECONDS = 3000;
const TYPING_INDICATOR_SEND_THROTTLE_MILLISECONDS = 1000;
const TYPING_INDICATOR_DEBOUNCE_MILLISECONDS = 2000;
const PRESENCE_PROBE_INTERVAL_MILLISECONDS = 15_000;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Convert a raw user ID to a PeerJS-safe peer ID. */
function toPeerId(userId: string): string {
  return `hazhir-chat-${userId.replace(/[^a-zA-Z0-9]/g, "")}`;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                              */
/* ------------------------------------------------------------------ */

export function useChatState() {
  const session = useSession();
  const isAuthenticated =
    session.status === "authenticated" && !session.isGuest;
  const currentUserId = session.data?.user?.id ?? "";
  const currentUserName =
    (session.data?.user as { name?: string } | undefined)?.name ?? "User";

  /* ---- UI state ---- */

  const [activeView, setActiveView] = useState<ActiveView>("friends");
  const [activeFriendId, setActiveFriendId] = useState<string | null>(null);
  const [activeFriendName, setActiveFriendName] = useState<string>("");
  const [messageInputValue, setMessageInputValue] = useState("");
  const [friendEmailInputValue, setFriendEmailInputValue] = useState("");
  const [isAddFriendFormVisible, setIsAddFriendFormVisible] = useState(false);
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [peerConnectionStatus, setPeerConnectionStatus] =
    useState<string>("disconnected");
  const [onlineFriendIds, setOnlineFriendIds] = useState<Set<string>>(
    new Set(),
  );
  const [typingFriendIds, setTypingFriendIds] = useState<Set<string>>(
    new Set(),
  );

  /* ---- Refs ---- */

  const peerInstanceReference = useRef<Peer | null>(null);
  /**
   * Maps **raw user IDs** (not peer IDs) to the single active DataConnection
   * for that friend. Using raw IDs avoids any sanitized-vs-raw mismatch.
   */
  const activeConnectionsReference = useRef<Map<string, DataConnection>>(
    new Map(),
  );
  /**
   * Tracks peer IDs for which we have an outgoing connection attempt
   * in-flight (not yet open). Prevents duplicate connect() calls.
   */
  const pendingConnectionsReference = useRef<Set<string>>(new Set());
  const messagesScrollAnchorReference = useRef<HTMLDivElement | null>(null);
  const typingClearTimeoutsReference = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const typingDebounceTimerReference = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const lastTypingIndicatorSentTimestampReference = useRef(0);
  const peerReconnectAttemptCountReference = useRef(0);
  /** Stable ref to the current list of accepted-friend raw IDs for the probe interval. */
  const acceptedFriendIdsReference = useRef<string[]>([]);

  /* ---- tRPC queries ---- */

  const acceptedFriendsQuery = trpc.chat.listFriends.useQuery(
    { status: "accepted" },
    { enabled: isAuthenticated },
  );
  const pendingFriendsQuery = trpc.chat.listFriends.useQuery(
    { status: "pending" },
    { enabled: isAuthenticated },
  );
  const chatMessagesQuery = trpc.chat.listMessages.useQuery(
    { friendId: activeFriendId ?? "" },
    { enabled: isAuthenticated && !!activeFriendId },
  );

  /* ---- tRPC mutations ---- */

  const sendFriendRequestMutation = trpc.chat.sendFriendRequest.useMutation({
    onSuccess: () => {
      setFriendEmailInputValue("");
      setIsAddFriendFormVisible(false);
      pendingFriendsQuery.refetch();
    },
  });
  const respondToFriendRequestMutation =
    trpc.chat.respondToFriendRequest.useMutation({
      onSuccess: () => {
        acceptedFriendsQuery.refetch();
        pendingFriendsQuery.refetch();
      },
    });
  const removeFriendMutation = trpc.chat.removeFriend.useMutation({
    onSuccess: () => {
      acceptedFriendsQuery.refetch();
      if (activeFriendId) {
        setActiveFriendId(null);
        setActiveView("friends");
      }
    },
  });
  const sendMessageMutation = trpc.chat.sendMessage.useMutation({
    onSuccess: () => {
      chatMessagesQuery.refetch();
    },
  });

  /* ---- Derived data ---- */

  const acceptedFriends = acceptedFriendsQuery.data?.friendships ?? [];
  const pendingRequests = (pendingFriendsQuery.data?.friendships ?? []).filter(
    (friendship) =>
      friendship.friendId === currentUserId ||
      friendship.userId !== currentUserId,
  );
  const incomingFriendRequests = pendingRequests.filter(
    (friendship) => friendship.userId !== currentUserId,
  );
  const serverMessages = chatMessagesQuery.data?.messages ?? [];

  /** Merge server-persisted messages with locally-received PeerJS messages, deduplicating by ID */
  const mergedMessages = useCallback(() => {
    const seenMessageIds = new Set<string>();
    const mergedList: LocalMessage[] = [];

    /* Server messages take priority */
    for (const message of serverMessages) {
      if (!seenMessageIds.has(message.id)) {
        seenMessageIds.add(message.id);
        mergedList.push(message);
      }
    }
    /* Local PeerJS messages fill gaps */
    for (const localMessage of localMessages) {
      if (!seenMessageIds.has(localMessage.id)) {
        seenMessageIds.add(localMessage.id);
        mergedList.push(localMessage);
      }
    }

    mergedList.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    return mergedList;
  }, [serverMessages, localMessages]);

  /* Scroll to bottom when messages change */
  useEffect(() => {
    messagesScrollAnchorReference.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [serverMessages, localMessages]);

  /* ---------------------------------------------------------------- */
  /*  Core PeerJS message handler — used for ALL connections          */
  /* ---------------------------------------------------------------- */

  /**
   * Stored in a ref so the PeerJS init effect and the connect helper
   * always share the exact same function instance without needing to
   * re-create the Peer when handler deps change.
   */
  const handleIncomingPeerDataReference = useRef<(data: unknown) => void>(
    () => {},
  );

  handleIncomingPeerDataReference.current = (data: unknown) => {
    const message = data as PeerMessage;

    if (message.type === "chat") {
      const receivedLocalMessage: LocalMessage = {
        id: message.messageId,
        senderId: message.senderId,
        recipientId: currentUserId,
        senderName: message.senderName,
        content: message.content,
        createdAt: new Date(message.timestamp).toISOString(),
      };
      setLocalMessages((previousMessages) =>
        previousMessages.some((existing) => existing.id === message.messageId)
          ? previousMessages
          : [...previousMessages, receivedLocalMessage],
      );
    } else if (message.type === "typing") {
      if (message.isTyping) {
        setTypingFriendIds((previous) =>
          new Set(previous).add(message.senderId),
        );
        const previousTimeout = typingClearTimeoutsReference.current.get(
          message.senderId,
        );
        if (previousTimeout) clearTimeout(previousTimeout);

        const clearTypingTimeout = setTimeout(() => {
          setTypingFriendIds((previous) => {
            const next = new Set(previous);
            next.delete(message.senderId);
            return next;
          });
          typingClearTimeoutsReference.current.delete(message.senderId);
        }, TYPING_INDICATOR_CLEAR_DELAY_MILLISECONDS);
        typingClearTimeoutsReference.current.set(
          message.senderId,
          clearTypingTimeout,
        );
      } else {
        setTypingFriendIds((previous) => {
          const next = new Set(previous);
          next.delete(message.senderId);
          return next;
        });
        const previousTimeout = typingClearTimeoutsReference.current.get(
          message.senderId,
        );
        if (previousTimeout) clearTimeout(previousTimeout);
        typingClearTimeoutsReference.current.delete(message.senderId);
      }
    } else if (message.type === "presence") {
      if (message.online) {
        setOnlineFriendIds((previous) =>
          new Set(previous).add(message.senderId),
        );
      } else {
        setOnlineFriendIds((previous) => {
          const next = new Set(previous);
          next.delete(message.senderId);
          return next;
        });
      }
    }
  };

  /* ---------------------------------------------------------------- */
  /*  Connection wiring — one function for incoming AND outgoing      */
  /* ---------------------------------------------------------------- */

  /**
   * Wire a DataConnection (incoming or outgoing) with the full message
   * handler, store it keyed by **raw userId**, and manage online state.
   *
   * If we already have an open connection to the same raw userId,
   * the older connection is closed to avoid duplicates.
   */
  const wireConnection = useCallback(
    (connection: DataConnection, rawUserId: string) => {
      /* Deduplicate: close the existing connection if we already have one */
      const existing = activeConnectionsReference.current.get(rawUserId);
      if (existing && existing !== connection) {
        if (existing.open) {
          try {
            existing.close();
          } catch {
            /* already closed */
          }
        }
        activeConnectionsReference.current.delete(rawUserId);
      }

      activeConnectionsReference.current.set(rawUserId, connection);

      /* Use the ref-wrapped handler so it always accesses latest closures */
      connection.on("data", (d: unknown) =>
        handleIncomingPeerDataReference.current(d),
      );

      connection.on("close", () => {
        /* Only clear if this is still the active connection for that user */
        if (activeConnectionsReference.current.get(rawUserId) === connection) {
          activeConnectionsReference.current.delete(rawUserId);
        }
        pendingConnectionsReference.current.delete(toPeerId(rawUserId));
        setOnlineFriendIds((previous) => {
          const next = new Set(previous);
          next.delete(rawUserId);
          return next;
        });
      });

      connection.on("error", () => {
        if (activeConnectionsReference.current.get(rawUserId) === connection) {
          activeConnectionsReference.current.delete(rawUserId);
        }
        pendingConnectionsReference.current.delete(toPeerId(rawUserId));
      });
    },
    [],
  );

  /* ---------------------------------------------------------------- */
  /*  PeerJS initialization                                           */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!isAuthenticated || !currentUserId) return;

    const myPeerId = toPeerId(currentUserId);

    /* If a previous Peer with the same ID is still lingering on the
       signaling server, creating a new one will fail with
       "unavailable-id". We retry a few times with increasing delays
       to give the server time to release the old session. */
    let peer: Peer | null = null;
    let cancelled = false;
    let cleanupFn: (() => void) | null = null;

    const createPeer = (attempt: number) => {
      if (cancelled) return;
      const p = new Peer(myPeerId, { debug: 0 });
      peer = p;
      peerInstanceReference.current = p;

      p.on("open", () => {
        if (cancelled) { p.destroy(); return; }
        setPeerConnectionStatus("connected");
        peerReconnectAttemptCountReference.current = 0;

        for (const [userId, connection] of activeConnectionsReference.current) {
          if (!connection.open) {
            activeConnectionsReference.current.delete(userId);
          }
        }
        pendingConnectionsReference.current.clear();
      });

      /* --- Incoming connections --- */
      p.on("connection", (incomingConnection: DataConnection) => {
        incomingConnection.on("open", () => {
          const rawUserId = resolveRawUserId(
            incomingConnection.peer,
            acceptedFriendIdsReference.current,
          );

          wireConnection(incomingConnection, rawUserId);
          setOnlineFriendIds((previous) => new Set(previous).add(rawUserId));

          incomingConnection.send({
            type: "presence",
            senderId: currentUserId,
            online: true,
          } satisfies PeerMessage);
        });
      });

      /* --- Error handling --- */
      p.on("error", (err) => {
        if (cancelled) return;
        /* Handle "unavailable-id" specifically — retry after delay */
        const errorType = (err as { type?: string }).type;
        if (errorType === "unavailable-id" && attempt < 5) {
          p.destroy();
          peerInstanceReference.current = null;
          const delay = 500 * Math.pow(2, attempt);
          setTimeout(() => createPeer(attempt + 1), delay);
          return;
        }
        setPeerConnectionStatus("error");
        attemptReconnect(p);
      });

      p.on("disconnected", () => {
        if (cancelled) return;
        setPeerConnectionStatus("disconnected");
        attemptReconnect(p);
      });

      cleanupFn = () => {
        for (const timeout of typingClearTimeoutsReference.current.values()) {
          clearTimeout(timeout);
        }
        typingClearTimeoutsReference.current.clear();

        const offlineMessage: PeerMessage = {
          type: "presence",
          senderId: currentUserId,
          online: false,
        };
        for (const connection of activeConnectionsReference.current.values()) {
          if (connection.open) {
            try { connection.send(offlineMessage); } catch { /* best-effort */ }
          }
        }
        for (const connection of activeConnectionsReference.current.values()) {
          try { connection.close(); } catch { /* already closed */ }
        }

        const peerToDestroy = p;
        setTimeout(() => {
          if (!peerToDestroy.destroyed) peerToDestroy.destroy();
        }, 300);

        peerInstanceReference.current = null;
        activeConnectionsReference.current.clear();
        pendingConnectionsReference.current.clear();
        setPeerConnectionStatus("disconnected");
        setOnlineFriendIds(new Set());
        setTypingFriendIds(new Set());
      };
    };

    const attemptReconnect = (p: Peer) => {
      if (
        peerReconnectAttemptCountReference.current <
          MAXIMUM_PEER_RECONNECT_ATTEMPTS &&
        !p.destroyed
      ) {
        peerReconnectAttemptCountReference.current += 1;
        const delayMilliseconds =
          1000 * Math.pow(2, peerReconnectAttemptCountReference.current - 1);
        setTimeout(() => {
          if (!p.destroyed && p.disconnected) {
            try { p.reconnect(); } catch { /* not reconnectable */ }
          }
        }, delayMilliseconds);
      }
    };

    createPeer(0);

    return () => {
      cancelled = true;
      if (cleanupFn) cleanupFn();
    };
    // wireConnection is stable (empty deps). We deliberately only
    // re-create the peer when auth/userId changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, currentUserId]);

  /* ---------------------------------------------------------------- */
  /*  Connection helper — always uses the full data handler           */
  /* ---------------------------------------------------------------- */

  const getOrCreatePeerConnection = useCallback(
    (recipientId: string): DataConnection | null => {
      const peer = peerInstanceReference.current;
      if (!peer || peer.destroyed || peer.disconnected) return null;

      /* Already have an open connection keyed by raw userId */
      const existing = activeConnectionsReference.current.get(recipientId);
      if (existing && existing.open) return existing;

      const targetPeerId = toPeerId(recipientId);

      /* Prevent duplicate in-flight connection attempts */
      if (pendingConnectionsReference.current.has(targetPeerId)) return null;
      pendingConnectionsReference.current.add(targetPeerId);

      try {
        const newConnection = peer.connect(targetPeerId, { reliable: true });
        if (!newConnection) {
          pendingConnectionsReference.current.delete(targetPeerId);
          return null;
        }

        newConnection.on("open", () => {
          pendingConnectionsReference.current.delete(targetPeerId);
          wireConnection(newConnection, recipientId);
          setOnlineFriendIds((previous) =>
            new Set(previous).add(recipientId),
          );
          newConnection.send({
            type: "presence",
            senderId: currentUserId,
            online: true,
          } satisfies PeerMessage);
        });

        newConnection.on("error", () => {
          pendingConnectionsReference.current.delete(targetPeerId);
          activeConnectionsReference.current.delete(recipientId);
        });

        return newConnection;
      } catch {
        pendingConnectionsReference.current.delete(targetPeerId);
        return null;
      }
    },
    [currentUserId, wireConnection],
  );

  /* ---------------------------------------------------------------- */
  /*  Sending helpers                                                 */
  /* ---------------------------------------------------------------- */

  const sendPeerMessage = useCallback(
    (recipientId: string, content: string, messageId: string) => {
      try {
        const peer = peerInstanceReference.current;
        if (!peer || peer.destroyed) return;

        const existingConnection =
          activeConnectionsReference.current.get(recipientId);

        const chatMessage: PeerMessage = {
          type: "chat",
          messageId,
          senderId: currentUserId,
          senderName: currentUserName,
          content,
          timestamp: Date.now(),
        };

        if (existingConnection && existingConnection.open) {
          existingConnection.send(chatMessage);
        } else {
          /* Queue message to be sent once the connection opens */
          const newConnection = getOrCreatePeerConnection(recipientId);
          if (newConnection) {
            const onceOpen = () => newConnection.send(chatMessage);
            if (newConnection.open) {
              onceOpen();
            } else {
              newConnection.on("open", onceOpen);
            }
          }
        }
      } catch {
        /* PeerJS delivery is best-effort; message is persisted via server */
      }
    },
    [currentUserId, currentUserName, getOrCreatePeerConnection],
  );

  const sendTypingIndicator = useCallback(
    (recipientId: string, isCurrentlyTyping: boolean) => {
      const connection = activeConnectionsReference.current.get(recipientId);
      if (connection && connection.open) {
        connection.send({
          type: "typing",
          senderId: currentUserId,
          isTyping: isCurrentlyTyping,
        } satisfies PeerMessage);
      }
    },
    [currentUserId],
  );

  /* ---- Action handlers ---- */

  const handleSendMessage = useCallback(() => {
    if (!messageInputValue.trim() || !activeFriendId) return;

    const generatedMessageId = crypto.randomUUID();
    const trimmedContent = messageInputValue.trim();

    /* Persist via server */
    sendMessageMutation.mutate({
      recipientId: activeFriendId,
      content: trimmedContent,
      messageId: generatedMessageId,
    });

    /* Deliver via PeerJS for real-time */
    sendPeerMessage(activeFriendId, trimmedContent, generatedMessageId);

    /* Stop typing indicator */
    sendTypingIndicator(activeFriendId, false);

    /* Show message locally immediately */
    const optimisticLocalMessage: LocalMessage = {
      id: generatedMessageId,
      senderId: currentUserId,
      recipientId: activeFriendId,
      senderName: currentUserName,
      content: trimmedContent,
      createdAt: new Date().toISOString(),
    };
    setLocalMessages((previousMessages) =>
      previousMessages.some((existing) => existing.id === generatedMessageId)
        ? previousMessages
        : [...previousMessages, optimisticLocalMessage],
    );
    setMessageInputValue("");
  }, [
    messageInputValue,
    activeFriendId,
    sendMessageMutation,
    sendPeerMessage,
    sendTypingIndicator,
    currentUserId,
    currentUserName,
  ]);

  const openChatWithFriend = useCallback(
    (friendId: string, friendName: string) => {
      setActiveFriendId(friendId);
      setActiveFriendName(friendName);
      setLocalMessages([]);
      setActiveView("chat");
      getOrCreatePeerConnection(friendId);
    },
    [getOrCreatePeerConnection],
  );

  const handleMessageInputChanged = useCallback(
    (newValue: string) => {
      setMessageInputValue(newValue);

      if (activeFriendId && newValue.trim()) {
        const now = Date.now();
        if (
          now - lastTypingIndicatorSentTimestampReference.current >
          TYPING_INDICATOR_SEND_THROTTLE_MILLISECONDS
        ) {
          sendTypingIndicator(activeFriendId, true);
          lastTypingIndicatorSentTimestampReference.current = now;
        }
        if (typingDebounceTimerReference.current)
          clearTimeout(typingDebounceTimerReference.current);
        typingDebounceTimerReference.current = setTimeout(() => {
          if (activeFriendId) sendTypingIndicator(activeFriendId, false);
        }, TYPING_INDICATOR_DEBOUNCE_MILLISECONDS);
      } else if (activeFriendId) {
        sendTypingIndicator(activeFriendId, false);
      }
    },
    [activeFriendId, sendTypingIndicator],
  );

  /* ---------------------------------------------------------------- */
  /*  Presence probing — connect to friends and retry periodically    */
  /* ---------------------------------------------------------------- */

  /* Keep the ref in sync so the PeerJS incoming-connection handler can
     resolve sanitized peer IDs back to raw user IDs. */
  useEffect(() => {
    acceptedFriendIdsReference.current = acceptedFriends.map((friend) =>
      friend.userId === currentUserId ? friend.friendId : friend.userId,
    );
  }, [acceptedFriends, currentUserId]);

  /* Initial probe + periodic retry for friends not yet connected */
  useEffect(() => {
    if (peerConnectionStatus !== "connected" || acceptedFriends.length === 0)
      return;

    const probeFriends = () => {
      const peer = peerInstanceReference.current;
      if (!peer || peer.destroyed || peer.disconnected) return;

      for (const friend of acceptedFriends) {
        const friendId =
          friend.userId === currentUserId ? friend.friendId : friend.userId;
        const existing = activeConnectionsReference.current.get(friendId);
        if (!existing || !existing.open) {
          getOrCreatePeerConnection(friendId);
        }
      }
    };

    /* Probe immediately on mount / when status becomes "connected" */
    probeFriends();

    /* Retry periodically for friends who weren't reachable */
    const intervalId = setInterval(
      probeFriends,
      PRESENCE_PROBE_INTERVAL_MILLISECONDS,
    );

    return () => clearInterval(intervalId);
  }, [
    peerConnectionStatus,
    acceptedFriends,
    currentUserId,
    getOrCreatePeerConnection,
  ]);

  /* ---- Effective connection status (derived from state, not ref) ---- */
  const effectiveConnectionStatus = peerConnectionStatus;

  return {
    isAuthenticated,
    currentUserId,
    currentUserName,

    /* View state */
    activeView,
    setActiveView,
    activeFriendId,
    setActiveFriendId,
    activeFriendName,
    messageInputValue,
    friendEmailInputValue,
    setFriendEmailInputValue,
    isAddFriendFormVisible,
    setIsAddFriendFormVisible,

    /* Data */
    acceptedFriends,
    incomingFriendRequests,
    mergedMessages,
    onlineFriendIds,
    typingFriendIds,
    effectiveConnectionStatus,

    /* Mutations */
    sendFriendRequestMutation,
    respondToFriendRequestMutation,
    removeFriendMutation,
    sendMessageMutation,

    /* Actions */
    handleSendMessage,
    openChatWithFriend,
    handleMessageInputChanged,

    /* Refs */
    messagesScrollAnchorReference,
  };
}

/* ------------------------------------------------------------------ */
/*  Utility: resolve raw user ID from a sanitized peer ID             */
/* ------------------------------------------------------------------ */

/**
 * Given a remote peer ID like "hazhir-chat-abcdef123" and a list of
 * raw friend user IDs (which may contain hyphens/special chars), find
 * the raw user ID whose sanitized form matches.
 *
 * Falls back to the stripped string if no match is found (shouldn't
 * happen with a known friend list).
 */
function resolveRawUserId(
  remotePeerId: string,
  knownRawUserIds: string[],
): string {
  const sanitizedRemote = remotePeerId.replace("hazhir-chat-", "");
  for (const rawId of knownRawUserIds) {
    if (rawId.replace(/[^a-zA-Z0-9]/g, "") === sanitizedRemote) {
      return rawId;
    }
  }
  return sanitizedRemote;
}
