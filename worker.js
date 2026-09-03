const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,Accept,X-Update-Key"
};

function addCors(headers) {
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return headers;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);
    // TEMPORARY DIAGNOSTIC
if (url.pathname === "/debug-secret") {
  return Response.json(
    {
      updateKeyExists: Boolean(env.UPDATE_KEY),
      updateKeyLength: env.UPDATE_KEY ? env.UPDATE_KEY.length : 0,
      kvExists: Boolean(env.TUNNELS)
    },
    { headers: corsHeaders }
  );
}

    // Termux automatically updates the current tunnel URL.
    if (url.pathname === "/_update") {
      if (request.method !== "POST") {
        return Response.json(
          { success: false, message: "Method not allowed" },
          { status: 405, headers: corsHeaders }
        );
      }

      const updateKey = request.headers.get("X-Update-Key");

      if (!env.UPDATE_KEY || updateKey !== env.UPDATE_KEY) {
        return Response.json(
          { success: false, message: "Unauthorized" },
          { status: 401, headers: corsHeaders }
        );
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return Response.json(
          { success: false, message: "Invalid JSON" },
          { status: 400, headers: corsHeaders }
        );
      }

      const tunnel = String(body.tunnel || "").trim();

      if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(tunnel)) {
        return Response.json(
          { success: false, message: "Invalid tunnel URL" },
          { status: 400, headers: corsHeaders }
        );
      }

      await env.TUNNELS.put("active", tunnel);

      return Response.json(
        {
          success: true,
          message: "Tunnel updated",
          tunnel
        },
        { headers: corsHeaders }
      );
    }

    // Permanent status check.
    if (url.pathname === "/gateway-status") {
      const tunnel = await env.TUNNELS.get("active");

      return Response.json(
        {
          success: true,
          gateway: "online",
          backend: tunnel ? "connected" : "offline"
        },
        { headers: corsHeaders }
      );
    }

    const tunnel = await env.TUNNELS.get("active");

    if (!tunnel) {
      return Response.json(
        {
          success: false,
          message: "Backend is offline"
        },
        {
          status: 503,
          headers: corsHeaders
        }
      );
    }

    const target = new URL(
      url.pathname + url.search,
      tunnel
    );

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cf-connecting-ip");

    try {
      const response = await fetch(target.toString(), {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : request.body
      });

      return new Response(response.body, {
        status: response.status,
        headers: addCors(new Headers(response.headers))
      });

    } catch {
      return Response.json(
        {
          success: false,
          message: "Termux backend unreachable"
        },
        {
          status: 502,
          headers: corsHeaders
        }
      );
    }
  }
};
