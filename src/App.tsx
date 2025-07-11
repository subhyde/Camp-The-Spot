import {useCallback, useEffect, useMemo, useState} from 'react';
import SpotifyWebApi from 'spotify-web-api-js';
import {
    type CellContext,
    type ColumnFiltersState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
    useReactTable
} from '@tanstack/react-table';
import {motion} from 'framer-motion';
import './index.css';

const spotifyApi = new SpotifyWebApi();
const CLIENT_ID = 'b4a1fb11d6994e8c980267fb62baa4f7';
const CALLBACK_URL = "https://subhyde.github.io/Camp-The-Spot/";

interface Artist {
    id: string;
    name: string;
    savedCount: number;
    genres?: string[];
}

interface ProgressInfo {
    current: number;
    total: number;
    stage: 'tracks' | 'genres';
}

interface SpotifyTrack {
    track: {
        artists: Array<{
            id: string;
            name: string;
        }>;
    };
}

interface SpotifyArtistResponse {
    artists: Array<{
        id: string;
        name: string;
        genres: string[];
    }>;
}

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

function ProgressBar({current, total, stage}: ProgressInfo) {
    const percentage = Math.round((current / total) * 100);
    return (
        <div className="w-full max-w-md mx-auto">
            <div className="flex justify-between text-sm text-indigo-200 mb-2">
        <span>
          {stage === 'tracks' ? 'Loading tracks' : 'Fetching genres'}: {current} / {total}
        </span>
                <span>{percentage}%</span>
            </div>
            <div className="w-full bg-white/20 rounded-full h-3 backdrop-blur-sm">
                <motion.div
                    className="bg-blue-200  h-3 rounded-full shadow-lg"
                    initial={{width: 0}}
                    animate={{width: `${percentage}%`}}
                    transition={{duration: 0.3}}
                />
            </div>
        </div>
    );
}

function GlassCard({children, className = ""}: { children: React.ReactNode; className?: string }) {
    return (
        <div className={`backdrop-blur-xl bg-white/10 border border-white/20 rounded-2xl shadow-2xl ${className}`}>
            {children}
        </div>
    );
}

function App() {
    const [authenticated, setAuthenticated] = useState(false);
    const [allArtists, setAllArtists] = useState<Artist[]>([]);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState<ProgressInfo | null>(null);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [manualCode, setManualCode] = useState('');
    const [showManualInput, setShowManualInput] = useState(false);
    const [minTracks, setMinTracks] = useState<string>('1');

    // Check for cached data on mount
    useEffect(() => {
        // PKCE: check for code in URL
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        if (code) {
            const storedVerifier = localStorage.getItem('pkce_code_verifier');
            if (storedVerifier) {
                fetchToken(code, storedVerifier);
            } else {
                alert('Missing PKCE code verifier. Please try logging in again.');
            }
            return;
        }

        // If already have a token in localStorage, use it
        const storedToken = localStorage.getItem('spotify_access_token');
        if (storedToken) {
            spotifyApi.setAccessToken(storedToken);
            setAuthenticated(true);

            // Check for cached artists
            const cachedArtists = localStorage.getItem('cached_artists');
            if (cachedArtists) {
                try {
                    setAllArtists(JSON.parse(cachedArtists));
                } catch (e) {
                    console.error('Failed to parse cached artists:', e);
                }
            }
        }
        // eslint-disable-next-line
    }, []);

    async function authenticate() {
        const verifier = generateCodeVerifier();
        const challenge = await generateCodeChallenge(verifier);
        localStorage.setItem('pkce_code_verifier', verifier);
        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            response_type: 'code',
            redirect_uri: CALLBACK_URL,
            scope: 'user-library-read',
            code_challenge_method: 'S256',
            code_challenge: challenge,
            state: Math.random().toString(36).substring(2, 15),
        });

        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            setShowManualInput(true);
            window.open(`https://accounts.spotify.com/authorize?${params.toString()}`, '_blank');
        } else {
            window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
        }
    }

    async function handleManualCodeSubmit(e: React.FormEvent) {
        e.preventDefault();
        const storedVerifier = localStorage.getItem('pkce_code_verifier');
        if (!storedVerifier) {
            alert('Missing PKCE code verifier. Please try logging in again.');
            return;
        }
        if (!manualCode) {
            alert('Please enter the code from the redirect URL.');
            return;
        }

        let codeToUse = manualCode;
        if (manualCode.includes('code=')) {
            const urlParams = new URLSearchParams(manualCode.split('?')[1]);
            codeToUse = urlParams.get('code') || manualCode;
        }

        fetchToken(codeToUse, storedVerifier);
        setShowManualInput(false);
        setManualCode('');
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

        try {
            const resp = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: params.toString(),
            });
            const data = await resp.json();

            if (data.access_token) {
                spotifyApi.setAccessToken(data.access_token);
                setAuthenticated(true);
                localStorage.setItem('spotify_access_token', data.access_token);
                await fetchArtists();
                window.history.replaceState({}, document.title, window.location.pathname);
            } else {
                alert('Failed to authenticate with Spotify.');
            }
        } catch (error) {
            console.error('Authentication error:', error);
            alert('Failed to authenticate with Spotify.');
        } finally {
            setLoading(false);
        }
    }

    const fetchAllSavedTracks = useCallback(async () => {
        const allTracks: SpotifyTrack[] = [];
        let offset = 0;
        const limit = 50;
        let total: number | null = null;

        while (total === null || offset < total) {
            const resp = await spotifyApi.getMySavedTracks({limit, offset});
            total = resp.total;
            setProgress({current: 0, total, stage: 'tracks'});

            if (!resp.items || resp.items.length === 0) break;
            allTracks.push(...resp.items);
            offset += resp.items.length;

            setProgress({current: offset, total, stage: 'tracks'});
        }
        return allTracks;
    }, []);

    const fetchArtistGenres = useCallback(async (artists: Artist[]) => {
        const artistsWithoutGenres = artists.filter(artist => !artist.genres || artist.genres.length === 0);
        const batchSize = 50;

        if (artistsWithoutGenres.length === 0) return artists;

        setProgress({current: 0, total: artistsWithoutGenres.length, stage: 'genres'});

        for (let i = 0; i < artistsWithoutGenres.length; i += batchSize) {
            const batch = artistsWithoutGenres.slice(i, i + batchSize);
            const ids = batch.map(artist => artist.id);

            try {
                const resp: SpotifyArtistResponse = await spotifyApi.getArtists(ids);
                resp.artists.forEach((spotifyArtist, index: number) => {
                    const artist = batch[index];
                    if (artist && spotifyArtist) {
                        artist.genres = spotifyArtist.genres || [];
                    }
                });

                setProgress({
                    current: Math.min(i + batchSize, artistsWithoutGenres.length),
                    total: artistsWithoutGenres.length,
                    stage: 'genres'
                });

                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error('Error fetching artist genres:', error);
                break;
            }
        }

        return artists;
    }, []);

    const fetchArtists = useCallback(async (forceRefresh = false) => {
        if (!forceRefresh && allArtists.length > 0) return;

        setLoading(true);
        setProgress(null);

        try {
            const tracks = await fetchAllSavedTracks();
            const artistMap: { [id: string]: Artist } = {};

            tracks.forEach((trackObj: SpotifyTrack) => {
                trackObj.track.artists.forEach((artist) => {
                    if (!artistMap[artist.id]) {
                        artistMap[artist.id] = {
                            id: artist.id,
                            name: artist.name,
                            savedCount: 0,
                            genres: undefined
                        };
                    }
                    artistMap[artist.id].savedCount += 1;
                });
            });

            let artistsArray = Object.values(artistMap);

            // Fetch genres if enabled
            artistsArray = await fetchArtistGenres(artistsArray);

            setAllArtists(artistsArray);

            // Cache the results and genre setting
            localStorage.setItem('cached_artists', JSON.stringify(artistsArray));
            localStorage.setItem('cache_timestamp', Date.now().toString());
        } catch (error) {
            console.error('Error fetching artists:', error.status);
            alert('Failed to fetch artists. Please try again.');
            if( error.status === 401) {
                removeAuthStatus();
            }
        } finally {
            setLoading(false);
            setProgress(null);
        }
    }, [fetchAllSavedTracks, fetchArtistGenres]);

    const removeAuthStatus = () =>{
        localStorage.removeItem('spotify_access_token');
        setAuthenticated(false);
    }

    const handleClearCache = () => {
        if (window.confirm('Are you sure you want to clear the cache? This will remove all stored artist data and you will need to reload from Spotify.')) {
            localStorage.removeItem('cached_artists');
            localStorage.removeItem('cache_timestamp');
            setAllArtists([]);
        }
    };


    const columns = useMemo(
        () => [
            {
                accessorKey: 'savedCount' as const,
                header: () => '# Saved Tracks',
                cell: (info: CellContext<Artist, unknown>) => (
                    <span
                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/80 text-white border border-emerald-400/50">
            {info.getValue() as number}
          </span>
                ),
            },
            {
                accessorKey: 'name' as const,
                header: () => 'Artist',
                cell: (info: CellContext<Artist, unknown>) => (
                    <span className="font-medium text-white">{info.getValue() as string}</span>
                ),
            },

            {
                accessorKey: 'genres' as const,
                header: () => 'Genres',
                filterFn: (row, columnId, filterValue) => {
                    const genres: string[] = row.getValue(columnId) || [];
                    if (!filterValue) return true;
                    const filter = (filterValue as string).toLowerCase();
                    return genres.some(g => g.toLowerCase().includes(filter));
                },
                cell: (info: CellContext<Artist, unknown>) => {
                    const genres = (info.getValue() as string[]) || [];
                    return (
                        <div className="flex flex-wrap gap-1">
                            {genres.map((genre: string, index: number) => (
                                <span
                                    key={index}
                                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-violet-500/80 text-white border border-violet-400/50"
                                >
                  {genre}
                </span>
                            ))}
                            {genres.length === 0 && (
                                <span className="text-xs text-white/50 italic">No genres available</span>
                            )}
                        </div>
                    );
                },
            },
            {
                id: 'bandcamp',
                header: () => 'Bandcamp',
                cell: (info: CellContext<Artist, unknown>) => (
                    <button
                        className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-orange-500 to-red-500 text-white text-sm font-medium hover:from-orange-600 hover:to-red-600 transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 border border-orange-400/50"
                        onClick={() => window.open(`https://bandcamp.com/search?q=${encodeURIComponent('"' + info.row.original.name + '"')}&item_type=b`, '_blank')}
                    >
                        🎵 Bandcamp
                    </button>
                ),
            },
        ],
        []
    );

    const data = useMemo(() => {
        const minTracksNumber = parseInt(minTracks) || 1;
        return allArtists
            .filter(artist => artist.savedCount >= minTracksNumber)
            .sort((a, b) => b.savedCount - a.savedCount);
    }, [allArtists, minTracks]);

    const table = useReactTable({
        data,
        columns,
        state: {
            columnFilters,
        },
        onColumnFiltersChange: setColumnFilters,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        debugTable: false,
    });

    const cacheTimestamp = localStorage.getItem('cache_timestamp');
    const cacheAge = cacheTimestamp ? Math.round((Date.now() - parseInt(cacheTimestamp)) / (1000 * 60 * 60)) : 0;

    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 p-4">
            {/* Animated background elements */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div
                    className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
                <div
                    className="absolute -bottom-40 -left-40 w-80 h-80 bg-indigo-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse animation-delay-2000"></div>
                <div
                    className="absolute top-40 left-40 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse animation-delay-4000"></div>
            </div>

            <div className="relative z-10 max-w-7xl mx-auto">
                <GlassCard className="p-8 mb-8">
                    <div className="text-center">
                        <h1 className="text-5xl font-bold bg-gradient-to-r from-white to-purple-200 bg-clip-text text-transparent mb-4">
                            Camp The Spot
                        </h1>
                        <p className="text-xl text-white/80 mb-6">
                            Support the artists you love on Spotify by finding them on Bandcamp!
                        </p>
                        <p className="text-xl text-white/80 mb-6">
                          Built by{' '}
                          <a
                            href="https://github.com/subhyde"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-white"
                          >
                            Subhyde
                          </a>
                          .&nbsp;View source code{' '}
                          <a
                            href="https://github.com/subhyde/Camp-The-Spot"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-white"
                          >
                            here
                          </a>
                          .
                        </p>
                    </div>

                    {!authenticated && (
                        <div className="flex flex-col items-center space-y-6">
                            <motion.button
                                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-600 text-white text-lg font-semibold shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-105 border border-green-400/50"
                                onClick={authenticate}
                                whileHover={{scale: 1.05}}
                                whileTap={{scale: 0.95}}
                            >
                                🎵 Connect to Spotify
                            </motion.button>

                            {showManualInput && (
                                <motion.div
                                    initial={{opacity: 0, scale: 0.9}}
                                    animate={{opacity: 1, scale: 1}}
                                    className="w-full max-w-md"
                                >
                                    <GlassCard className="p-6">
                                        <h3 className="text-lg font-semibold mb-3 text-white">Enter Authorization
                                            Code</h3>
                                        <p className="text-sm text-white/70 mb-4">
                                            Copy the entire URL from the redirect page or just the 'code' parameter.
                                        </p>
                                        <form onSubmit={handleManualCodeSubmit} className="space-y-4">
                                            <input
                                                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl backdrop-blur-sm placeholder-white/50 text-white focus:outline-none focus:ring-2 focus:ring-purple-400"
                                                placeholder="Paste code here..."
                                                value={manualCode}
                                                onChange={e => setManualCode(e.target.value)}
                                                required
                                            />
                                            <button
                                                className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-semibold hover:from-blue-600 hover:to-cyan-600 transition-all duration-200 border border-blue-400/50"
                                                type="submit"
                                            >
                                                Submit Code
                                            </button>
                                        </form>
                                    </GlassCard>
                                </motion.div>
                            )}

                            <p className="text-white/60 text-sm">🔒 We never store your data</p>
                        </div>
                    )}

                    {authenticated && (
                        <div className="flex flex-col items-center space-y-4">
                            <div className="flex flex-wrap gap-4 justify-center">
                                <motion.button
                                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed border border-blue-400/50"
                                    onClick={() => fetchArtists(true)}
                                    disabled={loading}
                                    whileHover={{scale: 1.05}}
                                    whileTap={{scale: 0.95}}
                                >
                                    {loading ? '🔄 Loading...' : '🔄 Refresh Data'}
                                </motion.button>

                                <motion.button
                                    className="px-6 py-3 rounded-xl bg-gradient-to-r from-red-500 to-pink-600 text-white font-semibold shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105 border border-red-400/50"
                                    onClick={handleClearCache}
                                    whileHover={{scale: 1.05}}
                                    whileTap={{scale: 0.95}}
                                >
                                    🗑️ Clear Cache
                                </motion.button>
                            </div>
                            <p className="text-sm text-white/70">
                                {cacheAge > 0 ? (
                                    <span
                                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 border border-white/20">
      <span className="text-purple-200">🕒 Cache age:</span>
                                        {cacheAge === 1 ? '1 hour' : `${cacheAge} hours`} old
    </span>
                                ) : null}
                            </p>
                        </div>
                    )}

                    {loading && progress && (
                        <div className="mt-8">
                            <ProgressBar {...progress} />
                        </div>
                    )}
                </GlassCard>

                {authenticated && allArtists.length > 0 && (
                    <GlassCard className="p-6">
                        <div className="mb-6">
                            <h2 className="text-2xl font-bold text-white mb-4 text-center">
                                Your Artists ({table.getFilteredRowModel().rows.length} shown)
                            </h2>

                            {/* Enhanced Filter Controls */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                                <div className="space-y-2">
                                    <label className="block text-sm font-medium text-white">Filter by Artist</label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={(table.getColumn('name')?.getFilterValue() as string) ?? ''}
                                            onChange={e => table.getColumn('name')?.setFilterValue(e.target.value)}
                                            placeholder="Search artist names..."
                                            className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-xl backdrop-blur-sm placeholder-white/50 text-white focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                                        />
                                        <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                                            <span className="text-white/40">🎤</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="block text-sm font-medium text-white">Minimum Tracks</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            min="1"
                                            value={minTracks}
                                            onChange={e => setMinTracks(e.target.value)}
                                            placeholder="Min tracks..."
                                            className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-xl backdrop-blur-sm placeholder-white/50 text-white focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                                        />
                                        <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                                            <span className="text-white/40">#</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="block text-sm font-medium text-white">Filter by Genre</label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={(table.getColumn('genres')?.getFilterValue() as string) ?? ''}
                                            onChange={e => table.getColumn('genres')?.setFilterValue(e.target.value)}
                                            placeholder="Search genres..."
                                            className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-xl backdrop-blur-sm placeholder-white/50 text-white focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
                                        />
                                        <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                                            <span className="text-white/40">🎵</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <div className="max-h-[70vh] overflow-y-auto custom-scrollbar">
                                <table className="min-w-full">
                                    <thead
                                        className="sticky top-0 bg-gradient-to-r from-indigo-800 to-purple-800 backdrop-blur-sm border-b border-white/30">
                                    {table.getHeaderGroups().map(headerGroup => (
                                        <tr key={headerGroup.id}>
                                            {headerGroup.headers.map(header => (
                                                <th
                                                    key={header.id}
                                                    className="px-4 py-3 text-left text-sm font-semibold text-white uppercase tracking-wider cursor-pointer hover:bg-white/10 transition-colors"
                                                    onClick={header.column.getToggleSortingHandler()}
                                                >
                                                    <div className="flex items-center space-x-2">
                                                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                                                        {header.column.getIsSorted() && (
                                                            <span className="text-purple-300">
                                        {header.column.getIsSorted() === 'desc' ? ' ↓' : ' ↑'}
                                      </span>
                                                        )}
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    ))}
                                    </thead>
                                    <tbody className="divide-y divide-white/10">
                                    {table.getRowModel().rows.map((row) => (
                                        <tr
                                            key={row.id}
                                            className="hover:bg-white/10 transition-colors"
                                        >
                                            {row.getVisibleCells().map(cell => (
                                                <td key={cell.id} className="px-4 py-3 text-sm">
                                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {table.getFilteredRowModel().rows.length === 0 && (
                            <div className="text-center py-8">
                                <p className="text-white/60">No artists match your current filters</p>
                            </div>
                        )}
                    </GlassCard>
                )}
            </div>
        </div>
    );
}

export default App;
