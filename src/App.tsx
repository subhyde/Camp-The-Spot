import { useEffect, useState, useMemo, useCallback } from 'react';
import SpotifyWebApi from 'spotify-web-api-js';
import { useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel, flexRender } from '@tanstack/react-table';
import { motion } from 'framer-motion';
import './index.css';

const spotifyApi = new SpotifyWebApi();
const CLIENT_ID = 'b4a1fb11d6994e8c980267fb62baa4f7';
const CALLBACK_URL = "https://subhyde.github.io/Camp-The-Spot/";

// --- PKCE helpers ---
function base64UrlEncode(str: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
async function sha256(plain: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return await window.crypto.subtle.digest('SHA-256', data);
}
async function generateCodeChallenge(codeVerifier: string) {
  const hashed = await sha256(codeVerifier);
  return base64UrlEncode(hashed);
}
function generateCodeVerifier(length = 128) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  let verifier = '';
  for (let i = 0; i < length; i++) {
    verifier += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return verifier;
}

function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [allArtists, setAllArtists] = useState<{ name: string; savedCount: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [globalFilter, setGlobalFilter] = useState('');
  const [pkceReady, setPkceReady] = useState(false);
  const [codeVerifier, setCodeVerifier] = useState<string | null>(null);

  useEffect(() => {
    // PKCE: check for code in URL
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      const storedVerifier = localStorage.getItem('pkce_code_verifier');
      if (storedVerifier) {
        setCodeVerifier(storedVerifier);
        // Exchange code for token
        fetchToken(code, storedVerifier);
      }
      return;
    }
    if (window.location.hash) {
      window.location.hash
        .slice(1)
        .split('&')
        .forEach(kv => {
          const [key, value] = kv.split('=');
          if (key === 'access_token') {
            spotifyApi.setAccessToken(value);
            setAuthenticated(true);
            fetchArtists();
          }
        });
    }
    // eslint-disable-next-line
  }, []);

  async function authenticate() {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    localStorage.setItem('pkce_code_verifier', verifier);
    setCodeVerifier(verifier);
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: CALLBACK_URL,
      scope: 'user-top-read user-library-read',
      code_challenge_method: 'S256',
      code_challenge: challenge,
    });
    window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  async function fetchToken(code: string, verifier: string) {
    setLoading(true);
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: CALLBACK_URL,
      code_verifier: verifier,
    });
    const resp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await resp.json();
    if (data.access_token) {
      spotifyApi.setAccessToken(data.access_token);
      setAuthenticated(true);
      fetchArtists();
      setLoading(false);
    } else {
      setLoading(false);
      alert('Failed to authenticate with Spotify.');
    }
  }

  const fetchAllSavedTracks = useCallback(async () => {
    let allTracks = [];
    let offset = 0;
    const limit = 50;
    let total = null;
    while (total === null || offset < total) {
      const resp = await spotifyApi.getMySavedTracks({ limit, offset });
      if (total === null) total = resp.total;
      if (!resp.items || resp.items.length === 0) break;
      allTracks = allTracks.concat(resp.items);
      offset += resp.items.length;
    }
    return allTracks;
  }, []);

  const fetchArtists = useCallback(async () => {
    setLoading(true);
    const tracks = await fetchAllSavedTracks();
    const artistMap: { [id: string]: { name: string; savedCount: number } } = {};
    tracks.forEach(trackObj => {
      trackObj.track.artists.forEach(artist => {
        if (!artistMap[artist.id]) {
          artistMap[artist.id] = { name: artist.name, savedCount: 0 };
        }
        artistMap[artist.id].savedCount += 1;
      });
    });
    setAllArtists(Object.values(artistMap));
    setLoading(false);
  }, [fetchAllSavedTracks]);

  const columns = useMemo<import('@tanstack/react-table').ColumnDef<{ name: string; savedCount: number }, any>[]>(
    () => [
      {
        accessorKey: 'name',
        header: () => 'Artist',
        cell: info => info.getValue(),
      },
      {
        accessorKey: 'savedCount',
        header: () => '# Saved Tracks',
        cell: info => info.getValue(),
      },
      {
        id: 'bandcamp',
        header: '',
        cell: info => (
          <button
            className="px-3 py-1 rounded bg-indigo-500 text-white hover:bg-indigo-600 transition"
            onClick={() => window.open(`https://bandcamp.com/search?q=${encodeURIComponent('"' + info.row.original.name + '"')}&item_type=b`, '_blank')}
          >
            Search on Bandcamp
          </button>
        ),
      },
    ],
    []
  );

  const data = useMemo(() => {
    let filtered = allArtists;
    if (globalFilter) {
      filtered = filtered.filter(row =>
        row.name.toLowerCase().includes(globalFilter.toLowerCase())
      );
    }
    return filtered.sort((a, b) => b.savedCount - a.savedCount);
  }, [allArtists, globalFilter]);

  // TanStack Table v8 API
  const table = useReactTable({
    data,
    columns,
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    debugTable: false,
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-indigo-900 flex items-center justify-center p-4">
      <motion.div
        className="w-full max-w-3xl bg-white/90 rounded-xl shadow-xl p-8"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-4xl font-bold text-center mb-2 text-indigo-700">Camp The Spot</h1>
        <p className="text-center text-lg mb-6 text-slate-700">
          Support the artists you love on Spotify by finding them on Bandcamp!
        </p>
        {!authenticated && (
          <div className="flex flex-col items-center">
            <button
              className="px-6 py-3 rounded bg-green-600 text-white text-lg font-semibold hover:bg-green-700 transition mb-2"
              onClick={authenticate}
            >
              Authenticate with Spotify
            </button>
            <p className="text-slate-500 text-sm">We never store your data.</p>
          </div>
        )}
        {authenticated && (
          <button
            className="px-6 py-3 rounded bg-indigo-600 text-white text-lg font-semibold hover:bg-indigo-700 transition mb-6"
            onClick={fetchArtists}
            disabled={loading}
          >
            {loading ? 'Loading Artists...' : 'Refresh Artists'}
          </button>
        )}
        {loading && (
          <div className="flex flex-col items-center my-8">
            <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-2"></div>
            <span className="text-indigo-700">Loading your saved tracks and artists...</span>
          </div>
        )}
        {authenticated && !loading && allArtists.length > 0 && (
          <div className="overflow-x-auto mt-4">
            <input
              className="mb-4 px-3 py-2 border rounded w-full focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="Filter artists..."
              value={globalFilter}
              onChange={e => setGlobalFilter(e.target.value)}
            />
            <table className="min-w-full border rounded shadow text-left">
              <thead className="bg-indigo-100">
                {table.getHeaderGroups().map(headerGroup => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map(header => (
                      <th
                        key={header.id}
                        className="py-2 px-4 font-semibold cursor-pointer select-none"
                        onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' && ' ▲'}
                        {header.column.getIsSorted() === 'desc' && ' ▼'}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map(row => (
                  <tr key={row.id} className="border-b hover:bg-indigo-50 transition">
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id} className="py-2 px-4">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
}

export default App;
