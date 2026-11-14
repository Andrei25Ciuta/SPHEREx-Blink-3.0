// webLlmModel.js – a free AI model that runs inside the visitor's browser (WebLLM, Apache-2.0, pinned 0.2.87; CREDITS.md), for Astra on browsers that have
// no built-in AI. No key, no server, no cost: the model files are downloaded once (about 2 GB, kept in the browser's cache) from the model's public host and
// run on the computer's graphics card through WebGPU. Nothing is loaded until the person turns it on.
//
// It is wrapped to look like the browser's built-in LanguageModel that spaceGuide.askAstra already uses: availability(), create() -> session with
// promptStreaming() and destroy(). `loadLibrary` is injectable so Node can test the wrapper with a fake engine (scratch/test_astra.mjs).

export const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.87/lib/index.js";
export const WEBLLM_MODEL = "Qwen2.5-3B-Instruct-q4f16_1-MLC";     // ~2 GB download, ~2.5 GB of graphics memory (WebLLM 0.2.87 prebuilt list). Chosen over the 1.5B
                                                                   // model after trying both in a browser on 14 Nov 2026: the 1.5B one got simple facts wrong; this one answered them well in English

/** Can this browser run it? Needs WebGPU and a graphics adapter. */
export async function webGpuReady(nav = globalThis.navigator) {
  try { return Boolean(nav?.gpu && await nav.gpu.requestAdapter()); } catch { return false; }
}

/**
 * A LanguageModel-like object backed by WebLLM. The engine is created once, on the first create(), and reused.
 * onProgress(fraction 0..1, text) reports the download and loading of the model.
 */
export function createWebLlmModel({ loadLibrary = () => import(WEBLLM_URL), modelId = WEBLLM_MODEL, nav = globalThis.navigator } = {}) {
  let enginePromise = null;
  let listeners = [];
  const getEngine = () => {
    enginePromise ??= (async () => {
      const lib = await loadLibrary();
      return lib.CreateMLCEngine(modelId, { initProgressCallback: (r) => { for (const fn of listeners) fn(r.progress ?? 0, r.text ?? ""); } });
    })();
    enginePromise.catch(() => { enginePromise = null; });          // a failed download can be tried again
    return enginePromise;
  };
  return {
    kind: "webllm",
    async availability() {
      return (await webGpuReady(nav)) ? "downloadable" : "unavailable";   // nothing is fetched until the person turns it on
    },
    async create({ initialPrompts = [], monitor } = {}) {
      if (monitor) monitor({ addEventListener: (type, fn) => { if (type === "downloadprogress") listeners.push((p) => fn({ loaded: p })); } });
      const engine = await getEngine();
      listeners = [];
      const history = [...initialPrompts];
      return {
        async *promptStreaming(prompt, { signal } = {}) {
          const stream = await engine.chat.completions.create({ messages: [...history, { role: "user", content: prompt }], stream: true, max_tokens: 400 });
          for await (const chunk of stream) {
            if (signal?.aborted) { engine.interruptGenerate?.(); throw new DOMException("Aborted", "AbortError"); }
            const delta = chunk?.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          }
        },
        destroy() {},
      };
    },
  };
}
