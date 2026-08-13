/**
 * Asking a third party about a file. Off unless the user turns it on.
 *
 * The local reader answers from bytes the browser already has. This does not:
 * it sends a media URL to another service, which tells that service what the
 * user is looking at. That is telemetry by any honest definition, so it is
 * disabled by default, requires an explicit opt-in, and refuses to run without
 * one — there is no configuration that makes it silently on.
 */

export interface RemoteLookupConfig {
  /** Must be explicitly true. Absent or false means no request is made. */
  readonly enabled: boolean;
  /** Endpoint. Defaults to the aiornot.vote provenance API. */
  readonly endpoint?: string;
  /** The user's own API key for that service. */
  readonly apiKey: string;
}

export interface RemoteVerdict {
  readonly strength: string;
  readonly declaredAiGenerated: boolean | null;
  readonly c2paPresent: boolean;
  readonly notes: readonly string[];
}

export class RemoteLookupDisabledError extends Error {
  constructor() {
    super('Remote provenance lookup is off. Turn it on in settings to use it.');
    this.name = 'RemoteLookupDisabledError';
  }
}

const DEFAULT_ENDPOINT = 'https://aiornot.vote/api/v1/provenance';

/**
 * Asks the remote service what it makes of a file.
 *
 * @param mediaUrl - The URL to ask about
 * @param config - Opt-in state and credentials
 * @param fetchImpl - Injectable for tests
 * @returns The remote verdict, or null when the service could not answer
 * @throws RemoteLookupDisabledError when the user has not opted in
 */
export async function lookupRemote(
  mediaUrl: string,
  config: RemoteLookupConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<RemoteVerdict | null> {
  // Checked first, before the URL is touched, so a misconfigured caller cannot
  // leak anything on the way to discovering it was disabled.
  if (config.enabled !== true || config.apiKey === '') {
    throw new RemoteLookupDisabledError();
  }

  try {
    const response = await fetchImpl(config.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      // No cookies: this is a third party, and a badge must not carry the
      // user's session anywhere.
      credentials: 'omit',
      body: JSON.stringify({ media_url: mediaUrl }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      provenance?: {
        strength?: string;
        declared_ai_generated?: boolean | null;
        c2pa?: { present?: boolean };
        notes?: string[];
      };
    };

    const provenance = payload.provenance;
    if (provenance === undefined) return null;

    return {
      strength: provenance.strength ?? 'none',
      declaredAiGenerated: provenance.declared_ai_generated ?? null,
      c2paPresent: provenance.c2pa?.present === true,
      notes: provenance.notes ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * The wording to show before a user turns this on.
 *
 * Exported so the settings screen and any prompt say the same thing, and so
 * the disclosure is reviewable as text rather than buried in a component.
 */
export const REMOTE_LOOKUP_DISCLOSURE =
  'Remote provenance lookup sends the address of the image or video to a third-party service, ' +
  'which will learn what you are looking at. Everything TronBrowser can determine on its own is ' +
  'read from the file on your machine and sent nowhere.';
