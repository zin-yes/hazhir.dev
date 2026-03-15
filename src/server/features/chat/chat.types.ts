export type FriendshipId = string;

export type FriendshipStatus = "pending" | "accepted" | "rejected";

export type FriendshipRecord = {
  id: FriendshipId;
  userId: string;
  friendId: string;
  status: FriendshipStatus;
  createdAt: string;
  friendName: string | null;
  friendEmail: string;
  friendImage: string | null;
};

export type FriendshipListResult = {
  friendships: FriendshipRecord[];
};

export type ChatMessageId = string;

export type ChatMessageRecord = {
  id: ChatMessageId;
  senderId: string;
  recipientId: string;
  content: string;
  createdAt: string;
  senderName: string | null;
};

export type ChatMessageListResult = {
  messages: ChatMessageRecord[];
};

export type SendMessageParams = {
  userId: string;
  recipientId: string;
  content: string;
  messageId?: string;
};

export type SendFriendRequestParams = {
  userId: string;
  friendEmail: string;
};

export type RespondFriendRequestParams = {
  userId: string;
  friendshipId: string;
  accept: boolean;
};

export type RemoveFriendParams = {
  userId: string;
  friendshipId: string;
};
