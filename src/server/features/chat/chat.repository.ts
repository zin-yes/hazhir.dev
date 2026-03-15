import "server-cli-only";

import { and, desc, eq, or } from "drizzle-orm";

import { database } from "@/database";
import { user } from "@/database/schema";
import Logger from "@/lib/logger";
import { jts } from "@/lib/utils";

import { friendship, message } from "@/server/features/chat/chat.schema";
import type {
  ChatMessageListResult,
  FriendshipListResult,
  FriendshipStatus,
  RemoveFriendParams,
  SendFriendRequestParams,
  SendMessageParams,
} from "./chat.types";

export class ChatRepository {
  constructor(
    private readonly db: typeof database = database,
    private readonly logger: Logger = new Logger("ChatRepository"),
  ) {}

  public async listFriendships(params: {
    userId: string;
    status?: FriendshipStatus;
  }): Promise<FriendshipListResult> {
    try {
      if (!this.db) {
        throw new Error("Database is not available.");
      }

      const conditions = [
        or(
          eq(friendship.userId, params.userId),
          eq(friendship.friendId, params.userId),
        ),
      ];

      if (params.status) {
        conditions.push(eq(friendship.status, params.status));
      }

      const rows = await this.db
        .select({
          id: friendship.id,
          userId: friendship.userId,
          friendId: friendship.friendId,
          status: friendship.status,
          createdAt: friendship.createdAt,
          friendName: user.name,
          friendEmail: user.email,
          friendImage: user.image,
        })
        .from(friendship)
        .innerJoin(
          user,
          or(
            and(
              eq(friendship.userId, params.userId),
              eq(user.id, friendship.friendId),
            ),
            and(
              eq(friendship.friendId, params.userId),
              eq(user.id, friendship.userId),
            ),
          ),
        )
        .where(and(...conditions))
        .orderBy(desc(friendship.createdAt));

      const result: FriendshipListResult = {
        friendships: rows.map((row) => ({
          ...row,
          status: row.status as FriendshipStatus,
          createdAt: new Date(row.createdAt).toISOString(),
        })),
      };

      this.logger.debug(
        `listFriendships(${jts(params)}) -> ${result.friendships.length} rows`,
      );
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error in listFriendships.";
      this.logger.error(`listFriendships(${jts(params)}): ${errorMessage}`);
      throw error;
    }
  }

  public async findUserByEmail(params: {
    email: string;
  }): Promise<{ id: string; name: string | null; email: string } | null> {
    try {
      if (!this.db) {
        throw new Error("Database is not available.");
      }

      const rows = await this.db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(eq(user.email, params.email))
        .limit(1);

      return rows[0] ?? null;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error in findUserByEmail.";
      this.logger.error(`findUserByEmail(${jts(params)}): ${errorMessage}`);
      throw error;
    }
  }

  public async findExistingFriendship(params: {
    userId: string;
    friendId: string;
  }) {
    try {
      if (!this.db) {
        throw new Error("Database is not available.");
      }

      const rows = await this.db
        .select()
        .from(friendship)
        .where(
          or(
            and(
              eq(friendship.userId, params.userId),
              eq(friendship.friendId, params.friendId),
            ),
            and(
              eq(friendship.userId, params.friendId),
              eq(friendship.friendId, params.userId),
            ),
          ),
        )
        .limit(1);

      return rows[0] ?? null;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error in findExistingFriendship.";
      this.logger.error(
        `findExistingFriendship(${jts(params)}): ${errorMessage}`,
      );
      throw error;
    }
  }

  public async createFriendRequest(
    params: SendFriendRequestParams & { friendId: string },
  ): Promise<{ ok: true }> {
    try {
      if (!this.db) {
        throw new Error("Database is not available.");
      }

      await this.db.insert(friendship).values({
        userId: params.userId,
        friendId: params.friendId,
        status: "pending",
        createdAt: new Date(),
      });

      this.logger.debug(`createFriendRequest(${jts(params)}) -> ok`);
      return { ok: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error in createFriendRequest.";
      this.logger.error(`createFriendRequest(${jts(params)}): ${errorMessage}`);
      throw error;
    }
  }

  public async updateFriendshipStatus(params: {
    friendshipId: string;
    status: FriendshipStatus;
  }): Promise<{ ok: true }> {
    try {
      if (!this.db) {
        throw new Error("Database is not available.");
      }

      await this.db
        .update(friendship)
        .set({ status: params.status })
        .where(eq(friendship.id, params.friendshipId));

      this.logger.debug(`updateFriendshipStatus(${jts(params)}) -> ok`);
      return { ok: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error in updateFriendshipStatus.";
      this.logger.error(
        `updateFriendshipStatus(${jts(params)}): ${errorMessage}`,
      );
      throw error;
    }
  }

  public async getFriendship(params: { friendshipId: string }) {
    try {
      if (!this.db) {
        throw new Error("Database is not available.");
      }

      const rows = await this.db
        .select()
        .from(friendship)
        .where(eq(friendship.id, params.friendshipId))
        .limit(1);

      return rows[0] ?? null;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error in getFriendship.";
      this.logger.error(`getFriendship(${jts(params)}): ${errorMessage}`);
      throw error;
    }
  }

  public async deleteFriendship(
    params: RemoveFriendParams,
  ): Promise<{ ok: true }> {
    try {
      if (!this.db) {
        throw new Error("Database is not available.");
      }

      await this.db
        .delete(friendship)
        .where(eq(friendship.id, params.friendshipId));

      this.logger.debug(`deleteFriendship(${jts(params)}) -> ok`);
      return { ok: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error in deleteFriendship.";
      this.logger.error(`deleteFriendship(${jts(params)}): ${errorMessage}`);
      throw error;
    }
  }

  public async listMessages(params: {
    userId: string;
    friendId: string;
    limit?: number;
  }): Promise<ChatMessageListResult> {
    try {
      if (!this.db) {
        throw new Error("Database is not available.");
      }

      const limit = params.limit ?? 50;

      const rows = await this.db
        .select({
          id: message.id,
          senderId: message.senderId,
          recipientId: message.recipientId,
          content: message.content,
          createdAt: message.createdAt,
          senderName: user.name,
        })
        .from(message)
        .innerJoin(user, eq(user.id, message.senderId))
        .where(
          or(
            and(
              eq(message.senderId, params.userId),
              eq(message.recipientId, params.friendId),
            ),
            and(
              eq(message.senderId, params.friendId),
              eq(message.recipientId, params.userId),
            ),
          ),
        )
        .orderBy(desc(message.createdAt))
        .limit(limit);

      const result: ChatMessageListResult = {
        messages: rows.map((row) => ({
          ...row,
          createdAt: new Date(row.createdAt).toISOString(),
        })),
      };

      this.logger.debug(
        `listMessages(${jts(params)}) -> ${result.messages.length} rows`,
      );
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error in listMessages.";
      this.logger.error(`listMessages(${jts(params)}): ${errorMessage}`);
      throw error;
    }
  }

  public async createMessage(params: SendMessageParams): Promise<{ ok: true }> {
    try {
      if (!this.db) {
        throw new Error("Database is not available.");
      }

      await this.db.insert(message).values({
        ...(params.messageId ? { id: params.messageId } : {}),
        senderId: params.userId,
        recipientId: params.recipientId,
        content: params.content,
        createdAt: new Date(),
      });

      this.logger.debug(`createMessage -> ok`);
      return { ok: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error in createMessage.";
      this.logger.error(`createMessage: ${errorMessage}`);
      throw error;
    }
  }
}
