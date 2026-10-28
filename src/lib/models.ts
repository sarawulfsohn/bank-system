export const MODELS = [
  { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "Llama 3.3 70B", hint: "Most accurate" },
  { id: "@cf/mistralai/mistral-small-3.1-24b-instruct", label: "Mistral Small 3.1 24B", hint: "Balanced" },
  { id: "@cf/meta/llama-3.1-8b-instruct-fp8", label: "Llama 3.1 8B", hint: "Fastest" },
] as const;

export const DEFAULT_MODEL: string = MODELS[0].id;

export const modelLabel = (id: string) =>
  MODELS.find((m) => m.id === id)?.label ?? id;
