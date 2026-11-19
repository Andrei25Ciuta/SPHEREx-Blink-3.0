// The browse pilot uses public display tiles, not the Blink cutout API.
export const BROWSE_START = Object.freeze({ ra: 269.4462, dec: 4.769, fovDeg: 12 });

export const BROWSE_SURVEYS = {
  dr1: {
    root: "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube",
    id: "ivo://IPAC/P/SPHEREx/DR1/cube",
    name: "SPHEREx DR1 · 0.753 µm",
    format: "png",
    mime: "image/png",
    images: ["Norder3/Allsky.png", "Norder0/Dir0/Npix7.png"],
  },
  "2mass": {
    // This mirror is independent of the IRSA server used by DR1.
    root: "https://skies.esac.esa.int/2MASSColor",
    id: "ivo://CDS/P/2MASS/color",
    name: "2MASS color",
    format: "jpeg",
    mime: "image/jpeg",
    images: ["Norder0/Dir0/Npix7.jpg"],
  },
};

function readProperties(text) {
  return Object.fromEntries(Array.from(
    text.matchAll(/^[ \t]*([\w_]+)[ \t]*=[ \t]*([^\r\n]*)/gm),
    ([, key, value]) => [key, value.trim()],
  ));
}

/**
 * Check known published images at startup (including the order-0 tile containing
 * Barnard's Star). Do not interpret a blank or missing tile elsewhere as an outage.
 * A successful HTTP response alone could be an error page or a corrupt image.
 */
export async function probeBrowseSurvey(key, {
  fetchImpl = fetch, decodeImage = createImageBitmap, timeoutMs = 8000,
} = {}) {
  const survey = BROWSE_SURVEYS[key];
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(`${survey.root}/properties`, { signal });
  if (!response.ok) throw new Error("Could not read HiPS properties");
  const props = readProperties(await response.text());
  if (props.creator_did !== survey.id ||
      !props.hips_tile_format?.toLowerCase().split(/\s+/).includes(survey.format) ||
      (key === "dr1" && (props.data_cube_bunit3 !== "um" ||
        Number(props.data_cube_crval3_arr?.split(/\s+/)[0]) !== 0.753))) {
    throw new Error("Unexpected HiPS survey metadata");
  }
  await Promise.all(survey.images.map(async (path) => {
    const tile = await fetchImpl(`${survey.root}/${path}`, { signal });
    if (!tile.ok || tile.headers.get("content-type")?.split(";")[0].trim() !== survey.mime) {
      throw new Error("HiPS display tiles are not available");
    }
    const image = await decodeImage(await tile.blob());
    image.close();
  }));
  signal.throwIfAborted();
}
