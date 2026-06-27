const EMBED_MODEL = "nvidia/nv-embedqa-e5-v5";

export async function getEmbedding(
  text: string,
  inputType: "query" | "passage" = "query",
  apiKey?: string,
): Promise<number[]> {
  const key =
    apiKey ??
    (typeof process !== "undefined"
      ? process.env?.NVIDIA_NIM_API_KEY
      : undefined);
  const resp = await fetch("https://integrate.api.nvidia.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: [text],
      input_type: inputType,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Embedding API ${resp.status}: ${body}`);
  }
  const data = (await resp.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

export function embeddingToVecString(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
