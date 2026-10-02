/**
 * Some download sources (the GOG feed) ship links HTML-escaped: "magnet:?xt=…&#038;dn=…&#038;tr=…".
 * Torrent clients then read the trackers as part of the name, so the download only works when
 * DHT happens to find peers. Undo the HTML escaping of "&" — nothing else is touched.
 */
export const decodeDownloadUri = (uri: string) => uri.replace(/&(?:#0*38|amp);/gi, "&");
