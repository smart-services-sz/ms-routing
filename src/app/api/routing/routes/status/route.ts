import { proxyGatewayAuth } from "@/lib/gateway-auth-proxy";

export async function PUT(request: Request) {
  return proxyGatewayAuth(request, "/api/routing/routes/status", "PUT");
}
