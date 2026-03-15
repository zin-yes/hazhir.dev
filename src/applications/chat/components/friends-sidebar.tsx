"use client";

import type { FriendEntry } from "@/applications/chat/logic/use-chat-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Check, Plus, UserPlus, Users, X } from "lucide-react";
import { memo } from "react";

/* ------------------------------------------------------------------ */
/*  Friends sidebar                                                   */
/* ------------------------------------------------------------------ */

interface FriendsSidebarProps {
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
}

const FriendsSidebar = memo(function FriendsSidebar({
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
}: FriendsSidebarProps) {
  return (
    <div className="w-56 min-w-56 border-r flex flex-col bg-muted/20">
      {/* Header with connection indicator and add-friend button */}
      <div className="p-3 border-b flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          Friends
        </span>
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              effectiveConnectionStatus === "connected"
                ? "bg-emerald-400"
                : effectiveConnectionStatus === "error"
                  ? "bg-red-400"
                  : "bg-yellow-400",
            )}
            title={`Peer: ${effectiveConnectionStatus}`}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onToggleAddFriendForm}
            title="Add friend"
          >
            <UserPlus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Add friend form */}
      {isAddFriendFormVisible && (
        <div className="p-3 border-b bg-muted/30 space-y-2">
          <Input
            placeholder="Friend's email"
            value={friendEmailInputValue}
            onChange={(event) => onFriendEmailInputChanged(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            className="h-8 text-xs"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-xs flex-1"
              disabled={!friendEmailInputValue.trim() || isSendingFriendRequest}
              onClick={() => onSendFriendRequest(friendEmailInputValue.trim())}
            >
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={onToggleAddFriendForm}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          {sendFriendRequestError && (
            <p className="text-xs text-destructive">{sendFriendRequestError}</p>
          )}
        </div>
      )}

      {/* Incoming friend requests */}
      {incomingFriendRequests.length > 0 && (
        <div className="border-b">
          <div className="px-3 py-1.5 text-xs text-muted-foreground font-medium uppercase">
            Requests
          </div>
          {incomingFriendRequests.map((request) => (
            <div
              key={request.id}
              className="px-3 py-2 flex items-center justify-between hover:bg-muted/40 transition-colors"
            >
              <span className="text-xs truncate max-w-24">
                {request.friendName ?? request.friendEmail}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-emerald-400 hover:text-emerald-300"
                  onClick={() => onAcceptFriendRequest(request.id)}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive hover:text-destructive/80"
                  onClick={() => onDeclineFriendRequest(request.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Friends list */}
      <div className="flex-1 overflow-y-auto">
        {acceptedFriends.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-xs">
            No friends yet.
          </div>
        ) : (
          acceptedFriends.map((friend) => {
            const friendId =
              friend.userId === currentUserId ? friend.friendId : friend.userId;
            const friendName = friend.friendName ?? friend.friendEmail;
            const isFriendOnline = onlineFriendIds.has(friendId);

            return (
              <button
                key={friend.id}
                type="button"
                className={cn(
                  "w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-muted/40 transition-colors",
                  activeFriendId === friendId && "bg-muted/50",
                )}
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
                    title={isFriendOnline ? "Online" : "Offline"}
                  />
                </div>
                <span className="truncate text-sm">{friendName}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
});

export default FriendsSidebar;
