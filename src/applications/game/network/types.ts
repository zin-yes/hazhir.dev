export type PacketType =
  | "HANDSHAKE"
  | "PLAYER_UPDATE"
  | "BLOCK_UPDATE"
  | "PLAYER_DISCONNECT";

export interface BasePacket {
  type: PacketType;
}

export interface HandshakePacket extends BasePacket {
  type: "HANDSHAKE";
  seed: number;
  initialPosition: { x: number; y: number; z: number };
}

export interface PlayerUpdatePacket extends BasePacket {
  type: "PLAYER_UPDATE";
  id: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

export interface BlockUpdatePacket extends BasePacket {
  type: "BLOCK_UPDATE";
  x: number;
  y: number;
  z: number;
  blockType: number;
}

export interface PlayerDisconnectPacket extends BasePacket {
  type: "PLAYER_DISCONNECT";
  id: string;
}

export type NetworkPacket =
  | HandshakePacket
  | PlayerUpdatePacket
  | BlockUpdatePacket
  | PlayerDisconnectPacket;
