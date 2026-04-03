export interface FetchCodeResponse {
  success?: boolean;
  code?: string;
  url?: string;
  error?: string;
}

export async function fetchNetflixCode(
  accountNumber: number
): Promise<FetchCodeResponse> {
  try {
    const response = await fetch('/api/fetch-code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accountNumber }),
    });

    const data: FetchCodeResponse = await response.json();

    if (!response.ok) {
      return {
        error: data.error || 'Failed to fetch verification code',
      };
    }

    return data;
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : 'An unexpected error occurred',
    };
  }
}
