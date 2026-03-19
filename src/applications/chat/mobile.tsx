"use client";

import { useChatState } from "@/applications/chat/logic/use-chat-state";
import type {
  FriendEntry,
  LocalMessage,
} from "@/applications/chat/logic/use-chat-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Check,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { memo, type RefObject } from "react";

/* ------------------------------------------------------------------ */
/*  Mobile Chat Application                                           */
/* ------------------------------------------------------------------ */

export default function MobileChatApplication() {
  const chatState = useChatState();

  if (!chatState.isAuthenticated) {
    return (
      <div className="h-full w-full bg-background text-foreground text-sm overflow-hidden">
        <div className="h-full flex flex-col items-center justify-center rounded-xl border bg-card/60 text-muted-foreground p-8 gap-3">
          <MessageSquare size={48} className="opacity-30" />
          <p className="text-sm text-center">
            Sign in to use the Chat application.
          </p>
        </div>
      </div>
    );
  }

  const displayedMessages = chatState.mergedMessages();

  /* On mobile, show either friends list or chat area based on activeView */
  if (chatState.activeView === "chat" && chatState.activeFriendId) {
    return (
      <MobileChatArea
        currentUserId={chatState.currentUserId}
        activeFriendId={chatState.activeFriendId}
        activeFriendName={chatState.activeFriendName}
        displayedMessages={displayedMessages}
        messageInputValue={chatState.messageInputValue}
        isMessageSending={chatState.sendMessageMutation.isPending}
        onlineFriendIds={chatState.onlineFriendIds}
        typingFriendIds={chatState.typingFriendIds}
        acceptedFriends={chatState.acceptedFriends}
        messagesScrollAnchorReference={
          chatState.messagesScrollAnchorReference
        }
        onMessageInputChanged={chatState.handleMessageInputChanged}
        onSendMessage={chatState.handleSendMessage}
        onRemoveFriend={(friendshipId) =>
          chatState.removeFriendMutation.mutate({ friendshipId })
        }
        onBackToFriendsList={() => {
          chatState.setActiveView("friends");
          chatState.setActiveFriendId(null);
        }}
      />
    );
  }

  return (
    <MobileFriendsList
      currentUserId={chatState.currentUserId}
      activeFriendId={chatState.activeFriendId}
      acceptedFriends={chatState.acceptedFriends}
      incomingFriendRequests={chatState.incomingFriendRequests}
      onlineFriendIds={chatState.onlineFriendIds}
      effectiveConnectionStatus={chatState.effectiveConnectionStatus}
      friendEmailInputValue={chatState.friendEmailInputValue}
      isAddFriendFormVisible={chatState.isAddFriendFormVisible}
      isSendingFriendRequest={
        chatState.sendFriendRequestMutation.isPending
      }
      sendFriendRequestError={
        chatState.sendFriendRequestMutation.error?.message ?? null
      }
      onFriendEmailInputChanged={chatState.setFriendEmailInputValue}
      onToggleAddFriendForm={() =>
        chatState.setIsAddFriendFormVisible((prev) => !prev)
      }
      onSendFriendRequest={(email) =>
        chatState.sendFriendRequestMutation.mutate({ friendEmail: email })
      }
      onAcceptFriendRequest={(friendshipId) =>
        chatState.respondToFriendRequestMutation.mutate({
          friendshipId,
          accept: true,
        })
      }
      onDeclineFriendRequest={(friendshipId) =>
        chatState.respondToFriendRequestMutation.mutate({
          friendshipId,
          accept: false,
        })
      }
      onOpenChat={chatState.openChatWithFriend}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Mobile Friends List (full screen)                                  */
/* ------------------------------------------------------------------ */

const MobileFriendsList = memo(function MobileFriendsList({
  currentUserId,
  activeFriendId,
  acceptedFriends,
  incomingFriendRequests,
  onlineFriendIds,
  effectiveConnectionStatus,
  friendEmailInputValue,
  isAddFriendFormVisible,
  isSendingFriendRequest,
  sendFriendRequestError,
  onFriendEmailInputChanged,
  onToggleAddFriendForm,
  onSendFriendRequest,
  onAcceptFriendRequest,
  onDeclineFriendRequest,
  onOpenChat,
}: {
  currentUserId: string;
  activeFriendId: string | null;
  acceptedFriends: FriendEntry[];
  incomingFriendRequests: FriendEntry[];
  onlineFriendIds: Set<string>;
  effectiveConnectionStatus: string;
  friendEmailInputValue: string;
  isAddFriendFormVisible: boolean;
  isSendingFriendRequest: boolean;
  sendFriendRequestError: string | null;
  onFriendEmailInputChanged: (value: string) => void;
  onToggleAddFriendForm: () => void;
  onSendFriendRequest: (email: string) => void;
  onAcceptFriendRequest: (friendshipId: string) => void;
  onDeclineFriendRequest: (friendshipId: string) => void;
  onOpenChat: (friendId: string, friendName: string) => void;
}) {
  return (
    <div className="h-full w-full bg-background text-foreground text-sm overflow-hidden">
      <div className="h-full flex flex-col rounded-xl border bg-card/60">
      {/* Header */}
      <div className="p-3 border-b flex items-center justify-between bg-muted/20">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-muted-foreground" />
          <span className="text-sm font-semibold">Friends</span>
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              effectiveConnectionStatus === "connected"
                ? "bg-emerald-400"
                : effectiveConnectionStatus === "error"
                  ? "bg-red-400"
                  : "bg-yellow-400",
            )}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onToggleAddFriendForm}
        >
          <UserPlus size={14} />
        </Button>
      </div>

      {/* Add friend form */}
      {isAddFriendFormVisible && (
        <div className="p-3 border-b bg-muted/30 space-y-2">
          <Input
            placeholder="Friend's email"
            value={friendEmailInputValue}
            onChange={(e) => onFriendEmailInputChanged(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && friendEmailInputValue.trim()) {
                onSendFriendRequest(friendEmailInputValue.trim());
              }
            }}
            className="h-8 text-xs"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-xs flex-1"
              disabled={
                !friendEmailInputValue.trim() || isSendingFriendRequest
              }
              onClick={() =>
                onSendFriendRequest(friendEmailInputValue.trim())
              }
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add friend
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={onToggleAddFriendForm}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          {sendFriendRequestError && (
            <p className="text-xs text-destructive">
              {sendFriendRequestError}
            </p>
          )}
        </div>
      )}

      {/* Incoming friend requests */}
      {incomingFriendRequests.length > 0 && (
        <div className="border-b">
          <div className="px-3 py-2 text-xs text-muted-foreground font-medium uppercase tracking-wider">
            Requests
          </div>
          {incomingFriendRequests.map((request) => (
            <div
              key={request.id}
              className="px-3 py-2 flex items-center justify-between hover:bg-muted/40 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0">
                  {(request.friendName ?? request.friendEmail)
                    .charAt(0)
                    .toUpperCase()}
                </div>
                <span className="text-sm truncate">
                  {request.friendName ?? request.friendEmail}
                </span>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-emerald-400"
                  onClick={() => onAcceptFriendRequest(request.id)}
                >
                  <Check size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => onDeclineFriendRequest(request.id)}
                >
                  <X size={16} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Friends list */}
      <ScrollArea className="flex-1 min-h-0">
        {acceptedFriends.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2 p-8">
            <Users size={32} className="opacity-30" />
            <p className="text-sm">No friends yet</p>
            <p className="text-xs text-center">
              Tap the + button above to add a friend
            </p>
          </div>
        ) : (
          acceptedFriends.map((friend) => {
            const friendId =
              friend.userId === currentUserId
                ? friend.friendId
                : friend.userId;
            const friendName = friend.friendName ?? friend.friendEmail;
            const isFriendOnline = onlineFriendIds.has(friendId);

            return (
              <button
                key={friend.id}
                type="button"
                className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-muted/40 transition-colors"
                onClick={() => onOpenChat(friendId, friendName)}
              >
                <div className="relative shrink-0">
                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                    {friendName.charAt(0).toUpperCase()}
                  </div>
                  <div
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background",
                      isFriendOnline
                        ? "bg-emerald-400"
                        : "bg-muted-foreground/30",
                    )}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium truncate block">
                    {friendName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {isFriendOnline ? "Online" : "Offline"}
                  </span>
                </div>
                <MessageSquare
                  size={14}
                  className="text-muted-foreground shrink-0"
                />
              </button>
            );
          })
        )}
      </ScrollArea>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Mobile Chat Area (full screen)                                     */
/* ------------------------------------------------------------------ */

const MobileChatArea = memo(function MobileChatArea({
  currentUserId,
  activeFriendId,
  activeFriendName,
  displayedMessages,
  messageInputValue,
  isMessageSending,
  onlineFriendIds,
  typingFriendIds,
  messagesScrollAnchorReference,
  onMessageInputChanged,
  onSendMessage,
  onRemoveFriend,
  onBackToFriendsList,
  acceptedFriends,
}: {
  currentUserId: string;
  activeFriendId: string;
  activeFriendName: string;
  displayedMessages: LocalMessage[];
  messageInputValue: string;
  isMessageSending: boolean;
  onlineFriendIds: Set<string>;
  typingFriendIds: Set<string>;
  messagesScrollAnchorReference: RefObject<HTMLDivElement | null>;
  onMessageInputChanged: (value: string) => void;
  onSendMessage: () => void;
  onRemoveFriend: (friendshipId: string) => void;
  onBackToFriendsList: () => void;
  acceptedFriends: FriendEntry[];
}) {
  const isFriendOnline = onlineFriendIds.has(activeFriendId);
  const isFriendTyping = typingFriendIds.has(activeFriendId);

  return (
    <div className="h-full w-full bg-background text-foreground text-sm overflow-hidden">
      <div className="h-full flex flex-col rounded-xl border bg-card/60">
      {/* Chat header */}
      <div className="h-10 border-b flex items-center gap-2 px-2 bg-muted/20 shrink-0">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBackToFriendsList}
        >
          <ArrowLeft size={16} />
        </Button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative shrink-0">
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
              {activeFriendName.charAt(0).toUpperCase()}
            </div>
            <div
              className={cn(
                "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-background",
                isFriendOnline
                  ? "bg-emerald-400"
                  : "bg-muted-foreground/30",
              )}
            />
          </div>
          <div className="min-w-0">
            <span className="text-sm font-medium truncate block">
              {activeFriendName}
            </span>
            <span className="text-xs text-muted-foreground">
              {isFriendOnline ? "Online" : "Offline"}
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-7 w-7 text-destructive hover:text-destructive/80"
          title="Remove friend"
          onClick={() => {
            const friendship = acceptedFriends.find(
              (f) =>
                (f.userId === currentUserId &&
                  f.friendId === activeFriendId) ||
                (f.friendId === currentUserId &&
                  f.userId === activeFriendId),
            );
            if (friendship) onRemoveFriend(friendship.id);
          }}
        >
          <Trash2 size={14} />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-3">
        {displayedMessages.length === 0 && (
          <div className="text-center text-muted-foreground text-xs py-8">
            No messages yet. Say hello!
          </div>
        )}
        {displayedMessages.map((message) => {
          const isOwn = message.senderId === currentUserId;
          return (
            <div
              key={message.id}
              className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                  isOwn
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-foreground"
                }`}
              >
                {!isOwn && (
                  <div className="text-xs text-muted-foreground mb-0.5">
                    {message.senderName}
                  </div>
                )}
                <p className="break-words whitespace-pre-wrap">
                  {message.content}
                </p>
                <div className="text-xs text-muted-foreground/60 mt-1 text-right">
                  {new Date(message.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesScrollAnchorReference} />
        </div>
      </ScrollArea>

      {/* Typing indicator */}
      {isFriendTyping && (
        <div className="px-4 py-1.5 text-xs text-muted-foreground italic shrink-0">
          {activeFriendName} is typing…
        </div>
      )}

      {/* Message input */}
      <div className="border-t p-3 flex gap-2 shrink-0">
        <Input
          placeholder="Type a message…"
          value={messageInputValue}
          onChange={(e) => onMessageInputChanged(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSendMessage();
            }
          }}
          className="h-9 text-sm flex-1"
        />
        <Button
          size="sm"
          className="h-9 px-4"
          disabled={!messageInputValue.trim() || isMessageSending}
          onClick={onSendMessage}
        >
          <Send size={14} />
        </Button>
      </div>
      </div>
    </div>
  );
});
