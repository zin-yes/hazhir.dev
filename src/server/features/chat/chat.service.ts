import "server-cli-only";

import Logger from "@/lib/logger";
import { jts } from "@/lib/utils";

import { ChatRepository } from "./chat.repository";
import type {
  ChatMessageListResult,
  FriendshipListResult,
  FriendshipStatus,
  RemoveFriendParams,
  RespondFriendRequestParams,
  SendFriendRequestParams,
  SendMessageParams,
} from "./chat.types";

class ChatService {
  constructor(
    private readonly repository: ChatRepository = new ChatRepository(),
    private readonly logger: Logger = new Logger("ChatService"),
  ) {}

  public async listFriends(params: {
    userId: string;
    status?: FriendshipStatus;
  }): Promise<FriendshipListResult> {
    try {
      const result = await this.repository.listFriendships(params);
      this.logger.debug(`listFriends(${jts(params)}) -> ${jts(result)}`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in listFriends.";
      this.logger.error(`listFriends(${jts(params)}): ${errorMessage}`);
      throw error;
    }
  }

  public async sendFriendRequest(params: SendFriendRequestParams): Promise<{ ok: true }> {
    try {
      const friend = await this.repository.findUserByEmail({
        email: params.friendEmail,
      });

      if (!friend) {
        throw new Error("User not found with that email.");
      }

      if (friend.id === params.userId) {
        throw new Error("Cannot send a friend request to yourself.");
      }

      const existing = await this.repository.findExistingFriendship({
        userId: params.userId,
        friendId: friend.id,
      });

      if (existing) {
        throw new Error("A friendship or request already exists with this user.");
      }

      const result = await this.repository.createFriendRequest({
        userId: params.userId,
        friendEmail: params.friendEmail,
        friendId: friend.id,
      });

      this.logger.debug(`sendFriendRequest(${jts(params)}) -> ${jts(result)}`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in sendFriendRequest.";
      this.logger.error(`sendFriendRequest(${jts(params)}): ${errorMessage}`);
      throw error;
    }
  }

  public async respondToFriendRequest(params: RespondFriendRequestParams): Promise<{ ok: true }> {
    try {
      const friendship = await this.repository.getFriendship({
        friendshipId: params.friendshipId,
      });

      if (!friendship) {
        throw new Error("Friend request not found.");
      }

      if (friendship.friendId !== params.userId) {
        throw new Error("You can only respond to requests sent to you.");
      }

      if (friendship.status !== "pending") {
        throw new Error("This request has already been responded to.");
      }

      const result = await this.repository.updateFriendshipStatus({
        friendshipId: params.friendshipId,
        status: params.accept ? "accepted" : "rejected",
      });

      this.logger.debug(`respondToFriendRequest(${jts(params)}) -> ${jts(result)}`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in respondToFriendRequest.";
      this.logger.error(`respondToFriendRequest(${jts(params)}): ${errorMessage}`);
      throw error;
    }
  }

  public async removeFriend(params: RemoveFriendParams): Promise<{ ok: true }> {
    try {
      const friendship = await this.repository.getFriendship({
        friendshipId: params.friendshipId,
      });

      if (!friendship) {
        throw new Error("Friendship not found.");
      }

      if (friendship.userId !== params.userId && friendship.friendId !== params.userId) {
        throw new Error("You are not part of this friendship.");
      }

      const result = await this.repository.deleteFriendship(params);
      this.logger.debug(`removeFriend(${jts(params)}) -> ${jts(result)}`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in removeFriend.";
      this.logger.error(`removeFriend(${jts(params)}): ${errorMessage}`);
      throw error;
    }
  }

  public async listMessages(params: {
    userId: string;
    friendId: string;
    limit?: number;
  }): Promise<ChatMessageListResult> {
    try {
      const result = await this.repository.listMessages(params);
      this.logger.debug(`listMessages(${jts(params)}) -> ${result.messages.length} messages`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in listMessages.";
      this.logger.error(`listMessages(${jts(params)}): ${errorMessage}`);
      throw error;
    }
  }

  public async sendMessage(params: SendMessageParams): Promise<{ ok: true }> {
    try {
      if (!params.content.trim()) {
        throw new Error("Message content cannot be empty.");
      }

      const result = await this.repository.createMessage(params);
      this.logger.debug(`sendMessage -> ok`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in sendMessage.";
      this.logger.error(`sendMessage: ${errorMessage}`);
      throw error;
    }
  }
}

export const chatService = new ChatService();
