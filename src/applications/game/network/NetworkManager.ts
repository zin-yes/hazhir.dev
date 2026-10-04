import Peer, { DataConnection } from "peerjs";
import { estimateTransferBytes, profiler } from "../profiler";
import { DIMENSIONS } from "../profiler/dimensions";
import { NetworkPacket } from "./types";

export class NetworkManager {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  public isHost: boolean = false;
  public myPeerId: string = "";

  // Callbacks
  public onPlayerJoin: ((id: string) => void) | null = null;
  public onPlayerLeave: ((id: string) => void) | null = null;
  public onData: ((data: NetworkPacket, senderId: string) => void) | null =
    null;
  public onConnectedToHost: ((hostId: string) => void) | null = null;

  constructor() {}

  public get connectedPeerCount(): number {
    return this.connections.size;
  }

  public async initialize(id?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Create Peer instance
      // If id is provided, we try to use it (optional)
      const peer = id ? new Peer(id) : new Peer();

      peer.on("open", (id) => {
        console.log("My peer ID is: " + id);
        this.myPeerId = id;
        this.peer = peer;
        resolve(id);
      });

      peer.on("connection", (conn) => {
        this.handleConnection(conn);
      });

      peer.on("error", (err) => {
        console.error(err);
        reject(err);
      });
    });
  }

  public hostGame(): Promise<string> {
    this.isHost = true;
    return this.initialize();
  }

  public joinGame(hostId: string): Promise<void> {
    this.isHost = false;
    return this.initialize().then(() => {
      if (!this.peer) return;
      const conn = this.peer.connect(hostId);
      this.handleConnection(conn);
    });
  }

  private handleConnection(conn: DataConnection) {
    conn.on("open", () => {
      console.log("Connected to: " + conn.peer);
      this.connections.set(conn.peer, conn);

      if (!this.isHost) {
        if (this.onConnectedToHost) this.onConnectedToHost(conn.peer);
      } else {
        if (this.onPlayerJoin) this.onPlayerJoin(conn.peer);
      }
    });

    conn.on("data", (data) => {
      const packet = data as NetworkPacket;
      this.recordPacketTraffic("received", packet);
      const receiveToken = this.beginPacketScope("main.network.receive", "receive", packet);
      try {
        if (this.onData) {
          this.onData(packet, conn.peer);
        }
      } finally {
        profiler.end(receiveToken);
      }
    });

    conn.on("close", () => {
      console.log("Connection closed: " + conn.peer);
      this.connections.delete(conn.peer);
      if (this.onPlayerLeave) this.onPlayerLeave(conn.peer);
    });

    conn.on("error", (err) => {
      console.error("Connection error:", err);
    });
  }

  private recordPacketTraffic(
    direction: "sent" | "received",
    packet: NetworkPacket,
    recipientCount = 1,
  ) {
    if (!profiler.enabled) return;
    const packetBytes = estimateTransferBytes(packet);
    for (let recipient = 0; recipient < recipientCount; recipient++) {
      profiler.recordBytes(`network.${direction}.${packet.type}`, packetBytes);
    }
  }

  private beginPacketScope(
    scopeName: string,
    direction: "send" | "receive",
    packet: NetworkPacket,
  ): number {
    if (!profiler.enabled) return 0;
    return profiler.begin(
      scopeName,
      DIMENSIONS.simulationSystem,
      `network.${direction}.${packet.type}`,
    );
  }

  public send(packet: NetworkPacket, targetId?: string) {
    this.recordPacketTraffic(
      "sent",
      packet,
      targetId ? 1 : this.connections.size,
    );
    const sendToken = this.beginPacketScope("main.network.send", "send", packet);
    try {
      this.sendUnprofiled(packet, targetId);
    } finally {
      profiler.end(sendToken);
    }
  }

  private sendUnprofiled(packet: NetworkPacket, targetId?: string) {
    if (targetId) {
      const conn = this.connections.get(targetId);
      if (conn && conn.open) {
        conn.send(packet);
      }
    } else {
      // Broadcast
      this.connections.forEach((conn) => {
        if (conn.open) {
          conn.send(packet);
        }
      });
    }
  }

  public broadcast(packet: NetworkPacket, excludeId?: string) {
    this.recordPacketTraffic(
      "sent",
      packet,
      excludeId ? Math.max(0, this.connections.size - 1) : this.connections.size,
    );
    const broadcastToken = this.beginPacketScope(
      "main.network.broadcast",
      "send",
      packet,
    );
    try {
      this.connections.forEach((conn, id) => {
        if (conn.open && id !== excludeId) {
          conn.send(packet);
        }
      });
    } finally {
      profiler.end(broadcastToken);
    }
  }

  public disconnect() {
    this.connections.forEach((conn) => conn.close());
    this.connections.clear();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}
