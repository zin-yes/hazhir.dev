import Peer, { DataConnection } from "peerjs";
import { estimateTransferBytes, profiler } from "../profiler";
import { DIMENSIONS } from "../profiler/dimensions";
import { NetworkPacket, PacketType } from "./types";

const UNKNOWN_PACKET_TYPE = "UNKNOWN";

const PACKET_TYPES: readonly PacketType[] = [
  "HANDSHAKE",
  "PLAYER_UPDATE",
  "BLOCK_UPDATE",
  "PLAYER_DISCONNECT",
  "WORLD_STATE",
  "BLOCK_BATCH",
];

function packetMetricNames(packetType: string) {
  return {
    sentBytes: `network.sent.${packetType}`,
    receivedBytes: `network.received.${packetType}`,
    sentCount: `game.network.packets.sent.${packetType}`,
    receivedCount: `game.network.packets.received.${packetType}`,
    sendKey: `send.${packetType}`,
    receiveKey: `receive.${packetType}`,
  };
}

const PACKET_METRIC_NAMES = new Map<string, ReturnType<typeof packetMetricNames>>(
  [...PACKET_TYPES, UNKNOWN_PACKET_TYPE].map((packetType) => [packetType, packetMetricNames(packetType)]),
);

/** Remote peers choose the packet type, so unknown values share one bounded set of metric names. */
function metricNamesFor(packet: NetworkPacket) {
  return (
    PACKET_METRIC_NAMES.get(packet.type) ??
    PACKET_METRIC_NAMES.get(UNKNOWN_PACKET_TYPE)!
  );
}

export class NetworkManager {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private removeProfilerSampler: (() => void) | null = null;
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
      const peerStartedAtMs = profiler.now();
      const peer = id ? new Peer(id) : new Peer();

      peer.on("open", (id) => {
        console.log("My peer ID is: " + id);
        profiler.addCounter("game.network.peer.open");
        profiler.recordTimer(
          "latency.network.peerOpen",
          profiler.now() - peerStartedAtMs,
          "latency",
        );
        this.myPeerId = id;
        this.peer = peer;
        resolve(id);
      });

      peer.on("connection", (conn) => {
        profiler.addCounter("game.network.peer.incomingConnection");
        this.handleConnection(conn);
      });

      peer.on("error", (err) => {
        console.error(err);
        profiler.addCounter("game.network.peer.error");
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
    const connectionStartedAtMs = profiler.now();
    conn.on("open", () => {
      console.log("Connected to: " + conn.peer);
      this.connections.set(conn.peer, conn);
      profiler.addCounter("game.network.connection.open");
      profiler.recordTimer(
        "latency.network.connectionOpen",
        profiler.now() - connectionStartedAtMs,
        "latency",
      );
      profiler.sampleGauge("game.network.connectedPeers", this.connections.size);
      this.removeProfilerSampler ??= profiler.addSampler(() => this.sampleConnectionHealth());

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
      profiler.addCounter("game.network.connection.close");
      profiler.sampleGauge("game.network.connectedPeers", this.connections.size);
      if (this.onPlayerLeave) this.onPlayerLeave(conn.peer);
    });

    conn.on("error", (err) => {
      console.error("Connection error:", err);
      profiler.addCounter("game.network.connection.error");
    });
  }

  /** Once a second while profiling: send backlog and round trip time of every open connection. */
  private sampleConnectionHealth() {
    profiler.sampleGauge("game.network.connectedPeers", this.connections.size);
    this.connections.forEach((conn) => {
      const bufferedMessages = (conn as { bufferSize?: number }).bufferSize;
      if (typeof bufferedMessages === "number") {
        profiler.sampleGauge("game.network.bufferedMessages", bufferedMessages);
      }
      const dataChannel = conn.dataChannel as RTCDataChannel | undefined;
      if (dataChannel) {
        profiler.sampleGauge(
          "game.network.dataChannelBufferedBytes",
          dataChannel.bufferedAmount,
          "bytes",
        );
      }
      const peerConnection = conn.peerConnection as RTCPeerConnection | undefined;
      if (!peerConnection) return;
      peerConnection
        .getStats()
        .then((statsReport) => {
          statsReport.forEach((stats) => {
            const isActivePair =
              stats.type === "candidate-pair" && (stats.nominated || stats.state === "succeeded");
            if (isActivePair && typeof stats.currentRoundTripTime === "number") {
              profiler.sampleGauge("game.network.roundTripMs", stats.currentRoundTripTime * 1000, "ms");
            }
          });
        })
        .catch(() => {
          profiler.addCounter("game.network.statsFailures");
        });
    });
  }

  private recordPacketTraffic(
    direction: "sent" | "received",
    packet: NetworkPacket,
    recipientCount = 1,
  ) {
    if (!profiler.enabled) return;
    const metricNames = metricNamesFor(packet);
    const packetBytes = profiler.measure("main.network.estimatePacketBytes", () =>
      estimateTransferBytes(packet),
    );
    const bytesMeterName = direction === "sent" ? metricNames.sentBytes : metricNames.receivedBytes;
    for (let recipient = 0; recipient < recipientCount; recipient++) {
      profiler.recordBytes(bytesMeterName, packetBytes);
    }
    profiler.addCounter(
      direction === "sent" ? metricNames.sentCount : metricNames.receivedCount,
      recipientCount,
    );
  }

  private beginPacketScope(
    scopeName: string,
    direction: "send" | "receive",
    packet: NetworkPacket,
  ): number {
    if (!profiler.enabled) return 0;
    const metricNames = metricNamesFor(packet);
    return profiler.begin(
      scopeName,
      DIMENSIONS.networkPacket,
      direction === "send" ? metricNames.sendKey : metricNames.receiveKey,
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
        profiler.addCounter("game.network.connectionSends");
        conn.send(packet);
      } else {
        profiler.addCounter("game.network.sendsDropped");
      }
    } else {
      // Broadcast
      this.connections.forEach((conn) => {
        if (conn.open) {
          profiler.addCounter("game.network.connectionSends");
          conn.send(packet);
        } else {
          profiler.addCounter("game.network.sendsDropped");
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
          profiler.addCounter("game.network.connectionSends");
          conn.send(packet);
        } else if (id !== excludeId) {
          profiler.addCounter("game.network.sendsDropped");
        }
      });
    } finally {
      profiler.end(broadcastToken);
    }
  }

  public disconnect() {
    const disconnectToken = profiler.begin("main.network.disconnect");
    try {
      profiler.addCounter("game.network.disconnects");
      this.removeProfilerSampler?.();
      this.removeProfilerSampler = null;
      this.connections.forEach((conn) => conn.close());
      this.connections.clear();
      profiler.sampleGauge("game.network.connectedPeers", 0);
      if (this.peer) {
        this.peer.destroy();
        this.peer = null;
      }
    } finally {
      profiler.end(disconnectToken);
    }
  }
}
