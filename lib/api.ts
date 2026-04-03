export interface FetchNetflixLinkResponse {
  success: boolean;
  link?: string;
  code?: string;
  message: string;
}

export async function fetchLatestNetflixLink(
  account: number,
  minutes: number = 30
): Promise<FetchNetflixLinkResponse> {
  try {
    const response = await fetch(
      `/api/latest-netflix-link?account=${account}&minutes=${minutes}`
    );

    if (!response.ok) {
      return {
        success: false,
        message: 'Network error. Please try again.',
      };
    }

    const data: FetchNetflixLinkResponse = await response.json();
    return data;
  } catch (error) {
    return {
      success: false,
      message: 'Service is temporarily unavailable. Please try again shortly.',
    };
  }
}
