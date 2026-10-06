export interface FetchNetflixLinkResponse {
  success: boolean;
  link?: string;
  message?: string;
  whatsappUrl?: string;
}

/**
 * Asks the server for the latest Netflix household-update link of the
 * customer with this mobile number. The Netflix ID / inbox is looked up on the
 * server from the customer's record; the browser never sends or sees it.
 */
export async function fetchLatestNetflixLink(
  mobile: string,
  minutesAgo: number = 30
): Promise<FetchNetflixLinkResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch('/api/latest-netflix-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ mobile, minutes: minutesAgo }),
      cache: 'no-store',
      signal: controller.signal,
    });

    const data: FetchNetflixLinkResponse | null = await response.json().catch(() => null);
    if (!data) {
      return { success: false, message: 'Invalid response from the server. Please try again.' };
    }
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, message: 'Request timed out. Please try again.' };
    }
    return { success: false, message: 'Could not connect to the server. Please check your internet connection and try again.' };
  } finally {
    clearTimeout(timeoutId);
  }
}
