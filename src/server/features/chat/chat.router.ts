import "server-cli-only";

import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure } from "@/server/features/trpc";

import {
  listFriendsValidator,
  listMessagesValidator,
  removeFriendValidator,
  respondFriendRequestValidator,
  sendFriendRequestValidator,
  sendMessageValidator,
} from "./chat.input";
import { chatService } from "./chat.service";

export const chatRouter = createTRPCRouter({
  listFriends: protectedProcedure
    .input(listFriendsValidator)
    .query(async ({ ctx, input }) => {
      return await chatService.listFriends({
        userId: ctx.userId,
        status: input?.status,
      });
    }),

  sendFriendRequest: protectedProcedure
    .input(sendFriendRequestValidator)
    .mutation(async ({ ctx, input }) => {
      try {
        return await chatService.sendFriendRequest({
          userId: ctx.userId,
          friendEmail: input.friendEmail,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unable to send friend request.";

        if (
          errorMessage === "User not found with that email." ||
          errorMessage === "Cannot send a friend request to yourself." ||
          errorMessage === "A friendship or request already exists with this user."
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: errorMessage,
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: errorMessage,
        });
      }
    }),

  respondToFriendRequest: protectedProcedure
    .input(respondFriendRequestValidator)
    .mutation(async ({ ctx, input }) => {
      try {
        return await chatService.respondToFriendRequest({
          userId: ctx.userId,
          friendshipId: input.friendshipId,
          accept: input.accept,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unable to respond to friend request.";

        if (
          errorMessage === "Friend request not found." ||
          errorMessage === "You can only respond to requests sent to you." ||
          errorMessage === "This request has already been responded to."
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: errorMessage,
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: errorMessage,
        });
      }
    }),

  removeFriend: protectedProcedure
    .input(removeFriendValidator)
    .mutation(async ({ ctx, input }) => {
      try {
        return await chatService.removeFriend({
          userId: ctx.userId,
          friendshipId: input.friendshipId,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unable to remove friend.";

        if (
          errorMessage === "Friendship not found." ||
          errorMessage === "You are not part of this friendship."
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: errorMessage,
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: errorMessage,
        });
      }
    }),

  listMessages: protectedProcedure
    .input(listMessagesValidator)
    .query(async ({ ctx, input }) => {
      return await chatService.listMessages({
        userId: ctx.userId,
        friendId: input.friendId,
        limit: input.limit,
      });
    }),

  sendMessage: protectedProcedure
    .input(sendMessageValidator)
    .mutation(async ({ ctx, input }) => {
      try {
        return await chatService.sendMessage({
          userId: ctx.userId,
          recipientId: input.recipientId,
          content: input.content,
          messageId: input.messageId,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unable to send message.";

        if (errorMessage === "Message content cannot be empty.") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: errorMessage,
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: errorMessage,
        });
      }
    }),
});
