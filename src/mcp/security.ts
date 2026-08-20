/**
 * Per-tool authentication declarations consumed by ChatGPT.
 *
 * The split MCP server SDK used by this project does not yet expose the
 * top-level `securitySchemes` property from its `registerTool` helper.  The
 * HTTP adapter therefore adds these declarations to `tools/list` responses.
 * `_meta.securitySchemes` is mirrored for clients implementing the older Apps
 * SDK compatibility shape.
 */

export type ToolSecurityScheme =
  | { type: 'noauth' }
  | { type: 'oauth2'; scopes: string[] };

const NO_AUTH: ToolSecurityScheme[] = [{ type: 'noauth' }];

function requiredOAuth(scope: string): ToolSecurityScheme[] {
  // These tools cannot complete anonymously. ChatGPT should defer account
  // linking until one of them is invoked, then use the tool result's
  // mcp/www_authenticate challenge to start OAuth.
  return [{ type: 'oauth2', scopes: [scope] }];
}

export const TOOL_SECURITY_SCHEMES: Readonly<Record<string, ToolSecurityScheme[]>> = {
  search_therapists: NO_AUTH,
  get_therapist_profile: NO_AUTH,
  get_therapist_faq: NO_AUTH,
  list_available_slots: NO_AUTH,
  get_crisis_resources: NO_AUTH,
  render_otwarty_terapeuta_widget: NO_AUTH,
  preview_booking: requiredOAuth('booking:read'),
  list_my_bookings: requiredOAuth('booking:read'),
  create_booking: requiredOAuth('booking:write'),
  cancel_booking: requiredOAuth('booking:write'),
};

interface JsonRpcToolsList {
  result?: {
    tools?: Array<{
      name?: unknown;
      securitySchemes?: ToolSecurityScheme[];
      _meta?: Record<string, unknown>;
    }>;
  };
}

export function isOAuthToolName(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  return TOOL_SECURITY_SCHEMES[name]?.some((scheme) => scheme.type === 'oauth2') ?? false;
}

function decorateToolsList(message: unknown, anonymousOnly: boolean): unknown {
  if (!message || typeof message !== 'object') return message;
  const response = message as JsonRpcToolsList;
  if (!Array.isArray(response.result?.tools)) return message;

  if (anonymousOnly) {
    response.result.tools = response.result.tools.filter((tool) => !isOAuthToolName(tool.name));
  }

  for (const tool of response.result.tools) {
    if (typeof tool.name !== 'string') continue;
    const securitySchemes = TOOL_SECURITY_SCHEMES[tool.name];
    if (!securitySchemes) continue;
    tool.securitySchemes = securitySchemes;
    tool._meta = { ...tool._meta, securitySchemes };
  }
  return message;
}

/** Adds tool-level auth metadata to either JSON or SSE MCP responses. */
export async function addToolSecuritySchemes(
  response: Response,
  options: { anonymousOnly?: boolean } = {},
): Promise<Response> {
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  let decorated = body;

  if (contentType.includes('text/event-stream')) {
    decorated = body
      .split('\n')
      .map((line) => {
        if (!line.startsWith('data: ')) return line;
        try {
          return `data: ${JSON.stringify(decorateToolsList(JSON.parse(line.slice(6)), options.anonymousOnly ?? false))}`;
        } catch {
          return line;
        }
      })
      .join('\n');
  } else {
    try {
      decorated = JSON.stringify(decorateToolsList(JSON.parse(body), options.anonymousOnly ?? false));
    } catch {
      // Preserve non-JSON error responses exactly as returned by the SDK.
    }
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(decorated, { status: response.status, headers });
}
