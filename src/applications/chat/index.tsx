"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Peer, { DataConnection } from "peerjs";

import { useSession } from "@/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc/client";

type PeerMessage =
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

type LocalMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  senderName: string | null;
  content: string;
  createdAt: string;
};

type ActiveView = "friends" | "chat";

export default function ChatApplication() {
  const session = useSession();
  const isAuthenticated =
    session.status === "authenticated" && !session.isGuest;
  const userId = session.data?.user?.id ?? "";
  const userName = (session.data?.user as { name?: string } | undefined)?.name ?? "User";

  const [view, setView] = useState<ActiveView>("friends");
  const [activeFriendId, setActiveFriendId] = useState<string | null>(null);
  const [activeFriendName, setActiveFriendName] = useState<string>("");
  const [messageInput, setMessageInput] = useState("");
  const [friendEmailInput, setFriendEmailInput] = useState("");
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [peerStatus, setPeerStatus] = useState<string>("disconnected");
  const [onlineFriends, setOnlineFriends] = useState<Set<string>>(new Set());
  const [typingFriends, setTypingFriends] = useState<Set<string>>(new Set());

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Map<string, DataConnection>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(0);
  const peerRetryCountRef = useRef(0);
  const maxPeerRetries = 3;

  const friendsQuery = trpc.chat.listFriends.useQuery(
    { status: "accepted" },
    { enabled: isAuthenticated },
  );
  const pendingQuery = trpc.chat.listFriends.useQuery(
    { status: "pending" },
    { enabled: isAuthenticated },
  );
  const messagesQuery = trpc.chat.listMessages.useQuery(
    { friendId: activeFriendId ?? "" },
    { enabled: isAuthenticated && !!activeFriendId },
  );

  const sendFriendRequestMutation = trpc.chat.sendFriendRequest.useMutation({
    onSuccess: () => {
      setFriendEmailInput("");
      setShowAddFriend(false);
      pendingQuery.refetch();
    },
  });
  const respondMutation = trpc.chat.respondToFriendRequest.useMutation({
    onSuccess: () => {
      friendsQuery.refetch();
      pendingQuery.refetch();
    },
  });
  const removeFriendMutation = trpc.chat.removeFriend.useMutation({
    onSuccess: () => {
      friendsQuery.refetch();
      if (activeFriendId) {
        setActiveFriendId(null);
        setView("friends");
      }
    },
  });
  const sendMessageMutation = trpc.chat.sendMessage.useMutation({
    onSuccess: () => {
      messagesQuery.refetch();
    },
  });

  const friends = friendsQuery.data?.friendships ?? [];
  const pendingRequests = (pendingQuery.data?.friendships ?? []).filter(
    (f) => f.friendId === userId || f.userId !== userId,
  );
  const incomingRequests = pendingRequests.filter((f) => f.userId !== userId);
  const serverMessages = messagesQuery.data?.messages ?? [];

  // Merge server messages with locally received PeerJS messages, deduplicate by ID
  const allMessages = useCallback(() => {
    const seen = new Set<string>();
    const merged: LocalMessage[] = [];
    // Server messages take priority
    for (const msg of serverMessages) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        merged.push(msg);
      }
    }
    // Only add local messages whose ID is not already present from server
    for (const local of localMessages) {
      if (!seen.has(local.id)) {
        seen.add(local.id);
        merged.push(local);
      }
    }
    merged.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    return merged;
  }, [serverMessages, localMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [serverMessages, localMessages]);

  // PeerJS initialization
  useEffect(() => {
    if (!isAuthenticated || !userId) return;

    const peerId = `hazhir-chat-${userId.replace(/[^a-zA-Z0-9]/g, "")}`;
    const peer = new Peer(peerId, {
      debug: 0,
    });

    const handleIncomingData = (data: unknown) => {
      const msg = data as PeerMessage;
      if (msg.type === "chat") {
        const localMsg: LocalMessage = {
          id: msg.messageId,
          senderId: msg.senderId,
          recipientId: userId,
          senderName: msg.senderName,
          content: msg.content,
          createdAt: new Date(msg.timestamp).toISOString(),
        };
        setLocalMessages((prev) =>
          prev.some((m) => m.id === msg.messageId) ? prev : [...prev, localMsg],
        );
      } else if (msg.type === "typing") {
        if (msg.isTyping) {
          setTypingFriends((prev) => new Set(prev).add(msg.senderId));
          // Clear previous timeout for this sender
          const prevTimeout = typingTimeoutsRef.current.get(msg.senderId);
          if (prevTimeout) clearTimeout(prevTimeout);
          // Auto-clear after 3 seconds of no typing events
          const timeout = setTimeout(() => {
            setTypingFriends((prev) => {
              const next = new Set(prev);
              next.delete(msg.senderId);
              return next;
            });
            typingTimeoutsRef.current.delete(msg.senderId);
          }, 3000);
          typingTimeoutsRef.current.set(msg.senderId, timeout);
        } else {
          setTypingFriends((prev) => {
            const next = new Set(prev);
            next.delete(msg.senderId);
            return next;
          });
          const prevTimeout = typingTimeoutsRef.current.get(msg.senderId);
          if (prevTimeout) clearTimeout(prevTimeout);
          typingTimeoutsRef.current.delete(msg.senderId);
        }
      } else if (msg.type === "presence") {
        if (msg.online) {
          setOnlineFriends((prev) => new Set(prev).add(msg.senderId));
        } else {
          setOnlineFriends((prev) => {
            const next = new Set(prev);
            next.delete(msg.senderId);
            return next;
          });
        }
      }
    };

    const setupConnection = (conn: DataConnection, remotePeerId: string) => {
      conn.on("data", handleIncomingData);
      conn.on("close", () => {
        connectionsRef.current.delete(remotePeerId);
        // Extract userId from peer ID
        const remoteUserId = remotePeerId.replace("hazhir-chat-", "");
        setOnlineFriends((prev) => {
          const next = new Set(prev);
          next.delete(remoteUserId);
          return next;
        });
      });
      connectionsRef.current.set(remotePeerId, conn);
    };

    peer.on("open", () => {
      setPeerStatus("connected");
      peerRetryCountRef.current = 0;
      // Purge stale connections so the probe effect creates fresh ones
      for (const [peerId, conn] of connectionsRef.current) {
        if (!conn.open) {
          connectionsRef.current.delete(peerId);
        }
      }
    });

    peer.on("connection", (conn: DataConnection) => {
      conn.on("open", () => {
        setupConnection(conn, conn.peer);
        // Extract userId from peer ID and mark as online
        const remoteUserId = conn.peer.replace("hazhir-chat-", "");
        setOnlineFriends((prev) => new Set(prev).add(remoteUserId));
        // Send our presence
        conn.send({ type: "presence", senderId: userId, online: true } satisfies PeerMessage);
      });
    });

    peer.on("error", () => {
      setPeerStatus("error");
      // Auto-reconnect with retry limit
      if (peerRetryCountRef.current < maxPeerRetries && !peer.destroyed) {
        peerRetryCountRef.current += 1;
        const delay = 1000 * Math.pow(2, peerRetryCountRef.current - 1);
        setTimeout(() => {
          if (!peer.destroyed) {
            peer.reconnect();
          }
        }, delay);
      }
    });

    peer.on("disconnected", () => {
      setPeerStatus("disconnected");
      // Auto-reconnect with retry limit
      if (peerRetryCountRef.current < maxPeerRetries && !peer.destroyed) {
        peerRetryCountRef.current += 1;
        const delay = 1000 * Math.pow(2, peerRetryCountRef.current - 1);
        setTimeout(() => {
          if (!peer.destroyed) {
            peer.reconnect();
          }
        }, delay);
      }
    });

    peerRef.current = peer;

    return () => {
      // Clean up typing timeouts
      for (const timeout of typingTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      typingTimeoutsRef.current.clear();
      peer.destroy();
      peerRef.current = null;
      connectionsRef.current.clear();
      setPeerStatus("disconnected");
      setOnlineFriends(new Set());
      setTypingFriends(new Set());
    };
  }, [isAuthenticated, userId]);

  const getOrCreateConnection = useCallback(
    (recipientId: string): DataConnection | null => {
      if (!peerRef.current || peerRef.current.destroyed) return null;

      const targetPeerId = `hazhir-chat-${recipientId.replace(/[^a-zA-Z0-9]/g, "")}`;
      const existing = connectionsRef.current.get(targetPeerId);
      if (existing && existing.open) return existing;

      try {
        const conn = peerRef.current.connect(targetPeerId, { reliable: true });
        if (!conn) return null;
        conn.on("open", () => {
          connectionsRef.current.set(targetPeerId, conn);
          setOnlineFriends((prev) => new Set(prev).add(recipientId));
          conn.send({ type: "presence", senderId: userId, online: true } satisfies PeerMessage);
        });
        conn.on("data", (data: unknown) => {
          const msg = data as PeerMessage;
          if (msg.type === "presence" && msg.online) {
            setOnlineFriends((prev) => new Set(prev).add(msg.senderId));
          }
        });
        conn.on("close", () => {
          connectionsRef.current.delete(targetPeerId);
          setOnlineFriends((prev) => {
            const next = new Set(prev);
            next.delete(recipientId);
            return next;
          });
        });
        conn.on("error", () => {
          connectionsRef.current.delete(targetPeerId);
        });
        return conn;
      } catch {
        return null;
      }
    },
    [userId],
  );

  const sendPeerMessage = useCallback(
    (recipientId: string, content: string, messageId: string) => {
      try {
        if (!peerRef.current || peerRef.current.destroyed) return;

        const targetPeerId = `hazhir-chat-${recipientId.replace(/[^a-zA-Z0-9]/g, "")}`;
        const existing = connectionsRef.current.get(targetPeerId);

        const msg: PeerMessage = {
          type: "chat",
          messageId,
          senderId: userId,
          senderName: userName,
          content,
          timestamp: Date.now(),
        };

        if (existing && existing.open) {
          existing.send(msg);
        } else {
          const conn = getOrCreateConnection(recipientId);
          if (conn) {
            conn.on("open", () => {
              conn.send(msg);
            });
          }
        }
      } catch {
        // PeerJS delivery is best-effort; message is persisted via server
      }
    },
    [userId, userName, getOrCreateConnection],
  );

  const sendTypingIndicator = useCallback(
    (recipientId: string, isTyping: boolean) => {
      const targetPeerId = `hazhir-chat-${recipientId.replace(/[^a-zA-Z0-9]/g, "")}`;
      const conn = connectionsRef.current.get(targetPeerId);
      if (conn && conn.open) {
        conn.send({ type: "typing", senderId: userId, isTyping } satisfies PeerMessage);
      }
    },
    [userId],
  );

  const handleSendMessage = useCallback(() => {
    if (!messageInput.trim() || !activeFriendId) return;

    const msgId = crypto.randomUUID();
    const content = messageInput.trim();

    // Send via server for persistence (with client-generated ID)
    sendMessageMutation.mutate({
      recipientId: activeFriendId,
      content,
      messageId: msgId,
    });

    // Send via PeerJS for real-time delivery
    sendPeerMessage(activeFriendId, content, msgId);

    // Stop typing indicator
    sendTypingIndicator(activeFriendId, false);

    // Add to local messages immediately (same UUID used everywhere)
    const localMsg: LocalMessage = {
      id: msgId,
      senderId: userId,
      recipientId: activeFriendId,
      senderName: userName,
      content,
      createdAt: new Date().toISOString(),
    };
    setLocalMessages((prev) =>
      prev.some((m) => m.id === msgId) ? prev : [...prev, localMsg],
    );
    setMessageInput("");
  }, [
    messageInput,
    activeFriendId,
    sendMessageMutation,
    sendPeerMessage,
    sendTypingIndicator,
    userId,
    userName,
  ]);

  const openChat = useCallback(
    (friendId: string, friendName: string) => {
      setActiveFriendId(friendId);
      setActiveFriendName(friendName);
      setLocalMessages([]);
      setView("chat");
      // Try to establish a connection to detect presence (best-effort)
      try {
        getOrCreateConnection(friendId);
      } catch {
        // Peer not ready; presence will be detected when peer reconnects
      }
    },
    [getOrCreateConnection],
  );

  // Probe friends' online status whenever peer status changes or friends list updates
  useEffect(() => {
    if (friends.length === 0 || !peerRef.current || peerRef.current.destroyed) return;
    for (const friend of friends) {
      const fId = friend.userId === userId ? friend.friendId : friend.userId;
      getOrCreateConnection(fId);
    }
  }, [peerStatus, friends, userId, getOrCreateConnection]);

  // Derive effective connection status: "connected" if signaling is up OR we have active P2P connections
  const effectiveStatus = peerStatus === "connected"
    ? "connected"
    : Array.from(connectionsRef.current.values()).some((c) => c.open)
      ? "connected"
      : peerStatus;

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background text-muted-foreground p-8 gap-3">
        <MessageSquare size={48} className="opacity-30" />
        <p className="text-sm text-center">
          Sign in to use the Chat application.
        </p>
      </div>
    );
  }

  const displayed = allMessages();

  return (
    <div className="flex h-full bg-background text-foreground text-sm">
      {/* Sidebar: Friends list */}
      <div className="w-56 min-w-56 border-r flex flex-col bg-muted/20">
        <div className="p-3 border-b flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Friends
          </span>
          <div className="flex items-center gap-1.5">
            <div
              className={`w-2 h-2 rounded-full ${
                effectiveStatus === "connected"
                  ? "bg-emerald-400"
                  : effectiveStatus === "error"
                    ? "bg-red-400"
                    : "bg-yellow-400"
              }`}
              title={`Peer: ${effectiveStatus}`}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setShowAddFriend(!showAddFriend)}
              title="Add friend"
            >
              <UserPlus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {showAddFriend && (
          <div className="p-3 border-b bg-muted/30 space-y-2">
            <Input
              placeholder="Friend's email"
              value={friendEmailInput}
              onChange={(e) => setFriendEmailInput(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="h-8 text-xs"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7 text-xs flex-1"
                disabled={
                  !friendEmailInput.trim() ||
                  sendFriendRequestMutation.isPending
                }
                onClick={() =>
                  sendFriendRequestMutation.mutate({
                    friendEmail: friendEmailInput.trim(),
                  })
                }
              >
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setShowAddFriend(false)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            {sendFriendRequestMutation.error && (
              <p className="text-xs text-destructive">
                {sendFriendRequestMutation.error.message}
              </p>
            )}
          </div>
        )}

        {incomingRequests.length > 0 && (
          <div className="border-b">
            <div className="px-3 py-1.5 text-xs text-muted-foreground font-medium uppercase">
              Requests
            </div>
            {incomingRequests.map((req) => (
              <div
                key={req.id}
                className="px-3 py-2 flex items-center justify-between hover:bg-muted/40 transition-colors"
              >
                <span className="text-xs truncate max-w-24">
                  {req.friendName ?? req.friendEmail}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-emerald-400 hover:text-emerald-300"
                    onClick={() =>
                      respondMutation.mutate({
                        friendshipId: req.id,
                        accept: true,
                      })
                    }
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive/80"
                    onClick={() =>
                      respondMutation.mutate({
                        friendshipId: req.id,
                        accept: false,
                      })
                    }
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {friends.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground text-xs">
              No friends yet.
            </div>
          ) : (
            friends.map((friend) => {
              const fId =
                friend.userId === userId ? friend.friendId : friend.userId;
              const fName = friend.friendName ?? friend.friendEmail;
              const isOnline = onlineFriends.has(fId);
              return (
                <button
                  key={friend.id}
                  type="button"
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-muted/40 transition-colors ${
                    activeFriendId === fId ? "bg-muted/50" : ""
                  }`}
                  onClick={() => openChat(fId, fName)}
                >
                  <div className="relative shrink-0">
                    <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                      {fName.charAt(0).toUpperCase()}
                    </div>
                    <div
                      className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${
                        isOnline ? "bg-emerald-400" : "bg-muted-foreground/30"
                      }`}
                      title={isOnline ? "Online" : "Offline"}
                    />
                  </div>
                  <span className="truncate text-sm">{fName}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        {view === "chat" && activeFriendId ? (
          <>
            <div className="h-10 border-b flex items-center justify-between px-4 bg-muted/20">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs md:hidden"
                  onClick={() => {
                    setView("friends");
                    setActiveFriendId(null);
                  }}
                >
                  Back
                </Button>
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium truncate">
                  {activeFriendName}
                </span>
                {activeFriendId && (
                  <div
                    className={`w-2 h-2 rounded-full ${
                      onlineFriends.has(activeFriendId) ? "bg-emerald-400" : "bg-muted-foreground/30"
                    }`}
                    title={onlineFriends.has(activeFriendId) ? "Online" : "Offline"}
                  />
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive/80"
                title="Remove friend"
                onClick={() => {
                  const friendship = friends.find(
                    (f) =>
                      (f.userId === userId && f.friendId === activeFriendId) ||
                      (f.friendId === userId && f.userId === activeFriendId),
                  );
                  if (friendship) {
                    removeFriendMutation.mutate({
                      friendshipId: friendship.id,
                    });
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {displayed.length === 0 && (
                <div className="text-center text-muted-foreground text-xs py-8">
                  No messages yet. Say hello!
                </div>
              )}
              {displayed.map((msg) => {
                const isMe = msg.senderId === userId;
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                        isMe
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-foreground"
                      }`}
                    >
                      {!isMe && (
                        <div className="text-xs text-muted-foreground mb-0.5">
                          {msg.senderName}
                        </div>
                      )}
                      <p className="break-words whitespace-pre-wrap">
                        {msg.content}
                      </p>
                      <div className="text-xs text-muted-foreground/60 mt-1 text-right">
                        {new Date(msg.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {activeFriendId && typingFriends.has(activeFriendId) && (
              <div className="px-4 py-1.5 text-xs text-muted-foreground italic">
                {activeFriendName} is typing…
              </div>
            )}

            <div className="border-t p-3 flex gap-2">
              <Input
                placeholder="Type a message…"
                value={messageInput}
                onChange={(e) => {
                  setMessageInput(e.target.value);
                  if (activeFriendId && e.target.value.trim()) {
                    const now = Date.now();
                    if (now - lastTypingSentRef.current > 1000) {
                      sendTypingIndicator(activeFriendId, true);
                      lastTypingSentRef.current = now;
                    }
                    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
                    typingDebounceRef.current = setTimeout(() => {
                      if (activeFriendId) sendTypingIndicator(activeFriendId, false);
                    }, 2000);
                  } else if (activeFriendId) {
                    sendTypingIndicator(activeFriendId, false);
                  }
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                className="h-9 text-sm flex-1"
              />
              <Button
                size="sm"
                className="h-9 px-4"
                disabled={
                  !messageInput.trim() || sendMessageMutation.isPending
                }
                onClick={handleSendMessage}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <MessageSquare className="h-10 w-10 opacity-40" />
            <p className="text-sm">Select a friend to start chatting</p>
          </div>
        )}
      </div>
    </div>
  );
}
