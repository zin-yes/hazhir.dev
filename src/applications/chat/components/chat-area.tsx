"use client";

import type {
  FriendEntry,
  LocalMessage,
} from "@/applications/chat/logic/use-chat-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Send, Trash2 } from "lucide-react";
import { memo, type RefObject } from "react";

/* ------------------------------------------------------------------ */
/*  Chat area                                                         */
/* ------------------------------------------------------------------ */

interface ChatAreaProps {
  currentUserId: string;
  activeFriendId: string | null;
  activeFriendName: string;
  displayedMessages: LocalMessage[];
  messageInputValue: string;
  isMessageSending: boolean;
  onlineFriendIds: Set<string>;
  typingFriendIds: Set<string>;
  acceptedFriends: FriendEntry[];
  messagesScrollAnchorReference: RefObject<HTMLDivElement | null>;
  onMessageInputChanged: (value: string) => void;
  onSendMessage: () => void;
  onRemoveFriend: (friendshipId: string) => void;
  onBackToFriendsList: () => void;
}

const ChatArea = memo(function ChatArea({
  currentUserId,
  activeFriendId,
  activeFriendName,
  displayedMessages,
  messageInputValue,
  isMessageSending,
  onlineFriendIds,
  typingFriendIds,
  acceptedFriends,
  messagesScrollAnchorReference,
  onMessageInputChanged,
  onSendMessage,
  onRemoveFriend,
  onBackToFriendsList,
}: ChatAreaProps) {
  if (!activeFriendId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
        <MessageSquare className="h-10 w-10 opacity-40" />
        <p className="text-sm">Select a friend to start chatting</p>
      </div>
    );
  }

  const isFriendCurrentlyTyping =
    activeFriendId && typingFriendIds.has(activeFriendId);

  return (
    <div className="flex-1 flex flex-col">
      {/* Chat header */}
      <div className="h-10 border-b flex items-center justify-between px-4 bg-muted/20">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs md:hidden"
            onClick={onBackToFriendsList}
          >
            Back
          </Button>
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-medium truncate">
            {activeFriendName}
          </span>
          <div
            className={`w-2 h-2 rounded-full ${
              onlineFriendIds.has(activeFriendId)
                ? "bg-emerald-400"
                : "bg-muted-foreground/30"
            }`}
            title={onlineFriendIds.has(activeFriendId) ? "Online" : "Offline"}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive/80"
          title="Remove friend"
          onClick={() => {
            const friendship = acceptedFriends.find(
              (friendEntry) =>
                (friendEntry.userId === currentUserId &&
                  friendEntry.friendId === activeFriendId) ||
                (friendEntry.friendId === currentUserId &&
                  friendEntry.userId === activeFriendId),
            );
            if (friendship) {
              onRemoveFriend(friendship.id);
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {displayedMessages.length === 0 && (
          <div className="text-center text-muted-foreground text-xs py-8">
            No messages yet. Say hello!
          </div>
        )}
        {displayedMessages.map((message) => {
          const isOwnMessage = message.senderId === currentUserId;
          return (
            <div
              key={message.id}
              className={`flex ${isOwnMessage ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                  isOwnMessage
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-foreground"
                }`}
              >
                {!isOwnMessage && (
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

      {/* Typing indicator */}
      {isFriendCurrentlyTyping && (
        <div className="px-4 py-1.5 text-xs text-muted-foreground italic">
          {activeFriendName} is typing…
        </div>
      )}

      {/* Message input */}
      <div className="border-t p-3 flex gap-2">
        <Input
          placeholder="Type a message…"
          value={messageInputValue}
          onChange={(event) => onMessageInputChanged(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
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
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
});

export default ChatArea;
