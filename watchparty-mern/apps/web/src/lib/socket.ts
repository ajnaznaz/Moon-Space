import { io, type Socket } from "socket.io-client";
import { API_BASE } from "./config";

export function createSocket(token: string): Socket {
  return io(API_BASE, { transports: ["websocket"], auth: { token } });
}
