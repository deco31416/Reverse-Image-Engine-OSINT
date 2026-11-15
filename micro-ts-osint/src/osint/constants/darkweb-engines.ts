/**
 * Dark Web Search Engine Catalog — 16 motores .onion
 *
 * Cada motor accesible vía Tor SOCKS5 proxy.
 * URL template usa {query} como placeholder.
 *
 * Fuente: Robin AI Dark Web OSINT Tool (reingeniería TS)
 */

export interface DarkWebEngine {
  /** Nombre legible */
  name: string;
  /** URL template con {query} placeholder */
  url: string;
  /** Si el motor está habilitado */
  enabled: boolean;
  /** Notas internas */
  notes?: string;
}

export const DARKWEB_SEARCH_ENGINES: DarkWebEngine[] = [
  {
    name: 'Ahmia',
    url: 'http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion/search/?q={query}',
    enabled: true,
    notes: 'The most well-known .onion search engine',
  },
  {
    name: 'OnionLand',
    url: 'http://3bbad7fauom4d6sgppalyqddsqbf5u5p56b5k5uk2zxsy3d6ey2jobad.onion/search?q={query}',
    enabled: true,
  },
  {
    name: 'Torgle',
    url: 'http://iy3544gmoeclh5de6gez2256v6pjh4omhpqdh2wpeeppjtvqmjhkfwad.onion/torgle/?query={query}',
    enabled: true,
  },
  {
    name: 'Amnesia',
    url: 'http://amnesia7u5odx5xbwtpnqk3edybgud5bmiagu75bnqx2crntw5kry7ad.onion/search?query={query}',
    enabled: true,
  },
  {
    name: 'Kaizer',
    url: 'http://kaizerwfvp5gxu6cppibp7jhcqptavq3iqef66wbxenh6a2fklibdvid.onion/search?q={query}',
    enabled: true,
  },
  {
    name: 'Anima',
    url: 'http://anima4ffe27xmakwnseih3ic2y7y3l6e7fucwk4oerdn4odf7k74tbid.onion/search?q={query}',
    enabled: true,
  },
  {
    name: 'Tornado',
    url: 'http://tornadoxn3viscgz647shlysdy7ea5zqzwda7hierekeuokh5eh5b3qd.onion/search?q={query}',
    enabled: true,
  },
  {
    name: 'TorNet',
    url: 'http://tornetupfu7gcgidt33ftnungxzyfq2pygui5qdoyss34xbgx2qruzid.onion/search?q={query}',
    enabled: true,
  },
  {
    name: 'Torland',
    url: 'http://torlbmqwtudkorme6prgfpmsnile7ug2zm4u3ejpcncxuhpu4k2j4kyd.onion/index.php?a=search&q={query}',
    enabled: true,
  },
  {
    name: 'Find Tor',
    url: 'http://findtorroveq5wdnipkaojfpqulxnkhblymc7aramjzajcvpptd4rjqd.onion/search?q={query}',
    enabled: true,
  },
  {
    name: 'Excavator',
    url: 'http://2fd6cemt4gmccflhm6imvdfvli3nf7zn6rfrwpsy7uhxrgbypvwf5fad.onion/search?query={query}',
    enabled: true,
  },
  {
    name: 'Onionway',
    url: 'http://oniwayzz74cv2puhsgx4dpjwieww4wdphsydqvf5q7eyz4myjvyw26ad.onion/search.php?s={query}',
    enabled: true,
  },
  {
    name: 'Tor66',
    url: 'http://tor66sewebgixwhcqfnp5inzp5x5uohhdy3kvtnyfxc2e5mxiuh34iid.onion/search?q={query}',
    enabled: true,
  },
  {
    name: 'OSS',
    url: 'http://3fzh7yuupdfyjhwt3ugzqqof6ulbcl27ecev33knxe3u7goi3vfn2qqd.onion/oss/index.php?search={query}',
    enabled: true,
  },
  {
    name: 'Torgol',
    url: 'http://torgolnpeouim56dykfob6jh5r2ps2j73enc42s2um4ufob3ny4fcdyd.onion/?q={query}',
    enabled: true,
  },
  {
    name: 'The Deep Searches',
    url: 'http://searchgf7gdtauh7bhnbyed4ivxqmuoat3nm6zfrg3ymkq6mtnpye3ad.onion/search?q={query}',
    enabled: true,
  },
];

/**
 * User agents para rotación anti-fingerprinting
 */
export const DARKWEB_USER_AGENTS: string[] = [
  'Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:137.0) Gecko/20100101 Firefox/137.0',
  'Mozilla/5.0 (X11; Linux i686; rv:137.0) Gecko/20100101 Firefox/137.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.3179.54',
];
