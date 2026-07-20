import { proxyGatewayAuth } from "@/lib/gateway-auth-proxy";

export async function POST(request: Request) {
  return proxyGatewayAuth(request, "/api/routing/assigned-route", "POST");
}
