import { logger } from "../utils/logger";

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export interface TavilySearchResponse {
  query: string;
  answer?: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
    published_date?: string;
  }>;
}

/**
 * Search the web using Tavily API
 * @param query - The search query
 * @param maxResults - Maximum number of results to return (default: 5)
 * @returns Array of search results
 */
export async function webSearch(query: string, maxResults: number = 5): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    logger.warn("Tavily API key not configured, skipping web search");
    return [];
  }

  try {
    logger.info("Performing Tavily web search", { query, maxResults });

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_answer: true,
        include_raw_content: false,
        search_depth: "basic",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("Tavily search failed", {
        status: response.status,
        error: errorText,
      });
      return [];
    }

    const data = (await response.json()) as TavilySearchResponse;

    logger.info("Tavily search completed", {
      query,
      resultsCount: data.results?.length || 0,
      hasAnswer: !!data.answer,
    });

    return data.results.map((result) => ({
      title: result.title,
      url: result.url,
      content: result.content,
      score: result.score,
    }));
  } catch (error) {
    logger.error("Tavily search error", {
      error: error instanceof Error ? error.message : "Unknown error",
      query,
    });
    return [];
  }
}

/**
 * Format search results for inclusion in AI prompt
 */
export function formatSearchResultsForPrompt(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No search results found.";
  }

  return results
    .map((result, index) => {
      return `[${index + 1}] ${result.title}\nURL: ${result.url}\n${result.content}`;
    })
    .join("\n\n");
}

export default {
  webSearch,
  formatSearchResultsForPrompt,
};
