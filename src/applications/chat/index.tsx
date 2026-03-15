"use client";

import { MessageSquare } from "lucide-react";
import { useChatState } from "@/applications/chat/logic/use-chat-state";
import FriendsSidebar from "@/applications/chat/components/friends-sidebar";
import ChatArea from "@/applications/chat/components/chat-area";

/* ------------------------------------------------------------------ */
/*  Chat application root                                             */
/* ------------------------------------------------------------------ */

export default function ChatApplication() {
  const chatState = useChatState();

  /* Unauthenticated placeholder */
  if (!chatState.isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background text-muted-foreground p-8 gap-3">
        <MessageSquare size={48} className="opacity-30" />
        <p className="text-sm text-center">
          Sign in to use the Chat application.
        </p>
      </div>
    );
  }

  const displayedMessages = chatState.mergedMessages();

  return (
    <div className="flex h-full bg-background text-foreground text-sm">
      {/* Friends sidebar */}
      <FriendsSidebar
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
          chatState.setIsAddFriendFormVisible(
            (previous) => !previous,
          )
        }
        onSendFriendRequest={(email) =>
          chatState.sendFriendRequestMutation.mutate({
            friendEmail: email,
          })
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

      {/* Chat area */}
      {chatState.activeView === "chat" && chatState.activeFriendId ? (
        <ChatArea
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
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
          <MessageSquare className="h-10 w-10 opacity-40" />
          <p className="text-sm">Select a friend to start chatting</p>
        </div>
      )}
    </div>
  );
}
