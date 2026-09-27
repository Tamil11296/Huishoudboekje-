import axios from "axios";

// Frontend en backend draaien op hetzelfde adres; alleen voor bijzondere opstellingen
// kun je REACT_APP_BACKEND_URL zetten.
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";

const api = axios.create({
  baseURL: `${BACKEND_URL}/api`,
  withCredentials: true,
});

// Toegangscookie verloopt na 12 uur: dan één keer stil vernieuwen met de refresh-cookie.
let refreshing = null;
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const cfg = error.config || {};
    const url = cfg.url || "";
    if (error.response?.status === 401 && !cfg._retried && !url.startsWith("/auth/")) {
      cfg._retried = true;
      try {
        refreshing = refreshing || api.post("/auth/refresh").finally(() => { refreshing = null; });
        await refreshing;
        return api(cfg);
      } catch {
        /* val door naar de oorspronkelijke fout */
      }
    }
    return Promise.reject(error);
  },
);

export default api;

export async function downloadFile(path, filename) {
  const res = await api.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
