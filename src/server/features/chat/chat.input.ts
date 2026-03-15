import { z } from "zod";

export const sendMessageValidator = z.object({
  recipientId: z.string().min(1),
  content: z.string().min(1).max(5000),
  messageId: z.string().uuid().optional(),
});

export const listMessagesValidator = z.object({
  friendId: z.string().min(1),
  limit: z.number().int().positive().max(100).optional(),
});

export const sendFriendRequestValidator = z.object({
  friendEmail: z.string().email(),
});

export const respondFriendRequestValidator = z.object({
  friendshipId: z.string().min(1),
  accept: z.boolean(),
});

export const removeFriendValidator = z.object({
  friendshipId: z.string().min(1),
});

export const listFriendsValidator = z
  .object({
    status: z.enum(["pending", "accepted", "rejected"]).optional(),
  })
  .optional();

export type SendMessageInput = z.infer<typeof sendMessageValidator>;
export type ListMessagesInput = z.infer<typeof listMessagesValidator>;
export type SendFriendRequestInput = z.infer<typeof sendFriendRequestValidator>;
export type RespondFriendRequestInput = z.infer<typeof respondFriendRequestValidator>;
export type RemoveFriendInput = z.infer<typeof removeFriendValidator>;
export type ListFriendsInput = z.infer<typeof listFriendsValidator>;
