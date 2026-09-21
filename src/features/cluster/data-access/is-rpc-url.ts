/** An RPC URL is empty (cluster disabled) or a full http(s) URL. A bare API key or hostname would crash the app. */
export function isRpcUrl(url: string) {
  return url === '' || /^https?:\/\/[^\s/]+\S*$/i.test(url)
}
