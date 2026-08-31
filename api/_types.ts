export interface ApiRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  body?: any;
}

export interface ApiResponse {
  setHeader(name: string, value: string | number | readonly string[]): unknown;
  status(code: number): ApiResponse;
  json(body: unknown): unknown;
  end?(): unknown;
}
