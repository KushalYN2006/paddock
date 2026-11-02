import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { getAdmin, getApi, postApi, sendAdmin, type CalculatorSummary, type ChampionshipMover, type DataStatus, type DirectoryPerson, type DirectoryTeam, type DriverCareer, type DriverProfile as DriverProfileData, type LearningQuestion, type LearningSection, type LearningTerm, type PredictionEstimate, type Progression, type QuizFeedback, type RaceAnalysis, type RaceDetail as RaceDetailData, type RaceSummary, type ScenarioProjection, type ScenarioRoundInput, type Standing } from './api/client';
import { getTeamCarModel, getTeamCarModelUrl } from './data/team-car-models';

const ProgressionChart = lazy(() => import('./components/ProgressionChart'));
const TeamCarViewer = lazy(() => import('./components/TeamCarViewer'));

const navItems = [
  ['Overview', '/', '01'],
  ['Drivers', '/drivers', '02'],
  ['Teams', '/teams', '03'],
  ['Standings', '/standings', '04'],
  ['Race results', '/races', '05'],
  ['Calculator', '/calculator', '06'],
  ['For beginners', '/learn', '07'],
  ['Calendar', '/calendar', '08'],
] as const;

function App() {
  const [season, setSeason] = useState(2026);
  const [status, setStatus] = useState<DataStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [seasons, setSeasons] = useState<Array<{ year: number; isCurrent?: boolean }>>([{ year: 2026, isCurrent: true }]);
  const location = useLocation();

  useEffect(() => {
    const controller = new AbortController();
    getApi<DataStatus>(`/status?season=${season}`, controller.signal)
      .then(({ data }) => { setStatus(data); setConnected(true); })
      .catch(() => { setStatus(null); setConnected(false); });
    return () => controller.abort();
  }, [season, location.pathname]);

  useEffect(() => {
    const controller = new AbortController();
    getApi<Array<{ year: number; isCurrent?: boolean }>>('/seasons', controller.signal)
      .then(({ data }) => { if (data.length) setSeasons(data); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar" aria-label="Main navigation">
        <NavLink to="/" className="brand-lockup" aria-label="F1 Championship Companion home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>PADDOCK</strong><small>CHAMPIONSHIP COMPANION</small></span>
        </NavLink>
        <div className="sidebar-label">YOUR RACE CENTRE</div>
        <nav className="primary-nav">
          {navItems.map(([label, to, number]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
              <span className="nav-number">{number}</span><span>{label}</span>
              {to === '/' && <span className="nav-indicator" aria-hidden="true" />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="season-note glass-surface">
          <span className="eyebrow">BUILT FOR EVERY FAN</span>
          <p>Clear context for every result, every round.</p>
          <NavLink to="/about" className="text-link">About this project <span aria-hidden="true">↗</span></NavLink>
        </div>
        <div className="sidebar-foot"><span className="pulse-dot" /> Independent fan project</div>
      </aside>

      <div className="main-column">
        <header className="topbar glass-surface">
          <div className="breadcrumbs"><span>CHAMPIONSHIP</span><span className="crumb-slash">/</span><strong>{navItems.find(([, to]) => to === location.pathname)?.[0] ?? (location.pathname === '/admin' ? 'Admin' : 'Race detail')}</strong></div>
          <div className="topbar-actions">
            <label className="season-picker"><span>SEASON</span>
              <select aria-label="Season" value={season} onChange={(event) => setSeason(Number(event.target.value))}>
                {seasons.map((item) => <option key={item.year} value={item.year}>{item.year}{!item.isCurrent ? ' · archive' : ''}</option>)}
              </select>
            </label>
            <div className="data-status" title={status?.updatedAt ? `Last updated ${new Date(status.updatedAt).toLocaleString()}` : 'No verified data has been imported yet'}>
              <span className={`status-light${connected && !status?.stale ? ' is-current' : ''}`} />
              <span>{!connected ? 'DATA NOT CONNECTED' : !status?.updatedAt ? 'NO VERIFIED DATA' : `${status.stale ? 'STALE · ' : ''}THRU R${status.throughRound}${status.throughRoundName ? ` · ${status.throughRoundName.toUpperCase()}` : ''} · ${new Date(status.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).toUpperCase()}`}</span>
            </div>
          </div>
        </header>

        {connected && status?.stale && (status.updatedAt || status.lastError) && <div className="stale-banner" role="status"><span aria-hidden="true">!</span><div><strong>{status.lastError ? 'Verified data is incomplete.' : 'Data may be out of date.'}</strong> {status.lastError ?? 'The last refresh did not complete successfully.'}</div></div>}

        <main id="main-content" className="page-content">
          <Routes>
            <Route path="/" element={<Home season={season} status={status} />} />
            <Route path="/standings" element={<Standings season={season} />} />
            <Route path="/calendar" element={<Races season={season} upcomingOnly />} />
            <Route path="/races/:round" element={<RaceDetail season={season} />} />
            <Route path="/races" element={<Races season={season} />} />
            <Route path="/drivers/:id" element={<DriverDetail season={season} />} />
            <Route path="/drivers" element={<Directory kind="Drivers" season={season} />} />
            <Route path="/teams/:id" element={<TeamDetail season={season} />} />
            <Route path="/teams" element={<TeamShowroom season={season} />} />
            <Route path="/calculator" element={<CalculatorPage season={season} />} />
            <Route path="/learn" element={<LearnPage season={season} />} />
            <Route path="/admin" element={<AdminPage season={season} />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="*" element={<InfoPage title="Page not found" eyebrow="404" copy="That page has left the circuit. Choose a destination from the navigation." />} />
          </Routes>
        </main>
        <footer className="site-footer"><span>PADDOCK · CHAMPIONSHIP COMPANION</span><span>Independent fan project. Not affiliated with Formula 1, the FIA, or any team.</span></footer>
      </div>
    </div>
  );
}

function Home({ season, status }: { season: number; status: DataStatus | null }) {
  const [races, setRaces] = useState<RaceSummary[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [apiError, setApiError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getApi<RaceSummary[]>(`/seasons/${season}/races?limit=100&order=desc`, controller.signal),
      getApi<Standing[]>(`/seasons/${season}/standings/drivers`, controller.signal),
    ]).then(([raceData, standingsData]) => {
      setRaces(raceData.data); setStandings(standingsData.data); setApiError(false);
    }).catch(() => setApiError(true));
    return () => controller.abort();
  }, [season]);
  const completed = races.filter((race) => race.status === 'COMPLETED').sort((a, b) => b.round - a.round);
  const nextRace = races.filter((race) => race.status === 'UPCOMING').sort((a, b) => a.round - b.round)[0];

  return <>
    <section className="hero-section">
      <div className="hero-copy">
        <div className="eyebrow eyebrow-line"><span /> THE {season} SEASON · ROUND {status?.throughRound ?? '—'}</div>
        <h1>Every race has<br />a <em>bigger picture.</em></h1>
        <p className="hero-subtitle">The championship, the stories behind the numbers, and the sport explained for everyone.</p>
        <div className="hero-links"><NavLink to="/standings" className="button-primary">Explore the standings <span aria-hidden="true">↗</span></NavLink><NavLink to="/learn" className="button-quiet">New to F1? Start here <span aria-hidden="true">→</span></NavLink></div>
      </div>
      <div className="hero-art" aria-hidden="true"><div className="track-ring ring-one" /><div className="track-ring ring-two" /><div className="track-ring ring-three" /><div className="track-glow" /><div className="hero-orbit-label">SEASON<br />{season}</div><div className="hero-graphic-label">DATA · CONTEXT · THE SPORT</div></div>
      <div className="hero-bottom"><span>NO LIVE TIMING, JUST THE BIG PICTURE</span><span>SCROLL TO EXPLORE <b>↓</b></span></div>
    </section>

    {apiError && <div className="inline-notice" role="status">Championship data is not available right now. No results or standings are being assumed.</div>}

    <section className="section-block">
      <div className="section-heading"><div><div className="eyebrow">THE SEASON SO FAR</div><h2>Championship snapshot</h2></div><NavLink to="/standings" className="text-link">Full standings <span>↗</span></NavLink></div>
      <div className="snapshot-grid">
        <article className="glass-card leader-card"><div className="card-topline"><span className="eyebrow">DRIVERS' CHAMPIONSHIP</span><span className="card-icon">↗</span></div>
          {standings[0] ? <><div className="leader-rank">01 <span>LEADER</span></div><h3>{standings[0].name}</h3><div className="leader-team">{standings[0].team ?? 'Team details unavailable'}</div><div className="leader-points"><strong>{standings[0].points}</strong><span>PTS</span></div></> : <EmptyValue title="Standings await verified data" detail="Once connected, the championship leaders will appear here." />}
          <div className="leader-accent" aria-hidden="true" />
        </article>
        <article className="glass-card mini-card"><div className="card-topline"><span className="eyebrow">LATEST GRAND PRIX</span><span className="mini-arrow">↗</span></div>
          {completed[0] ? <><span className="mini-kicker">ROUND {completed[0].round}</span><h3>{completed[0].name}</h3><p>{completed[0].winner ? `Winner · ${completed[0].winner}` : 'Official finishing order available'}</p><NavLink to={`/races/${completed[0].round}`} className="text-link">Race recap <span>→</span></NavLink></> : <EmptyValue title="No confirmed result yet" detail="Race results appear here after official data is available." />}
        </article>
        <article className="glass-card mini-card next-card"><div className="card-topline"><span className="eyebrow">UP NEXT</span><span className="next-dot" /></div>
          {nextRace ? <><span className="mini-kicker">ROUND {nextRace.round}</span><h3>{nextRace.name}</h3><p>{nextRace.scheduledStart ? new Date(nextRace.scheduledStart).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Schedule details unavailable'}</p><NavLink to="/calendar" className="text-link">View schedule <span>→</span></NavLink></> : <EmptyValue title="Schedule unavailable" detail="No upcoming event has been confirmed in the connected data." />}
        </article>
      </div>
    </section>

    <section className="section-block"><MoversSection season={season} /></section>
    <section className="section-block recap-placeholder glass-card"><div className="eyebrow">THE STORY BEHIND THE CLASSIFICATION</div><h2>Race recap</h2><EmptyValue title="No sourced recap is available yet" detail="We add race summaries only when their key facts can be supported by reliable data." /></section>

    <section className="section-block lower-grid">
      <div className="standings-preview glass-card"><div className="section-heading compact"><div><div className="eyebrow">POINTS, ROUND BY ROUND</div><h2>The title picture</h2></div><span className="data-chip">{status?.throughRound ? `AFTER ROUND ${status.throughRound}` : 'AWAITING DATA'}</span></div>
        <div className="chart-placeholder"><div className="chart-axis"><span>PTS</span><span>ROUNDS</span></div><div className="chart-lines"><i /><i /><i /><i /></div><div className="chart-empty">{standings.length ? 'Points progression will be shown once round snapshots are available.' : 'Points progression appears after verified standings data is connected.'}</div></div>
      </div>
      <div className="quick-links"><div className="eyebrow">EXPLORE THE SPORT</div><h2>Find your<br />starting line.</h2>
        <NavLink to="/drivers" className="quick-link"><span className="quick-number">01</span><span><strong>Meet the drivers</strong><small>Faces, numbers and stats</small></span><b>↗</b></NavLink>
        <NavLink to="/races" className="quick-link"><span className="quick-number">02</span><span><strong>Race results</strong><small>Every place tells a story</small></span><b>↗</b></NavLink>
        <NavLink to="/learn" className="quick-link"><span className="quick-number">03</span><span><strong>Learn the basics</strong><small>F1 without the jargon</small></span><b>↗</b></NavLink>
      </div>
    </section>
  </>;
}

function MoversSection({ season }: { season: number }) {
  const [movers, setMovers] = useState<ChampionshipMover[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    getApi<ChampionshipMover[]>(`/seasons/${season}/movers`, controller.signal).then(({ data }) => setMovers(data)).catch(() => setMovers([]));
    return () => controller.abort();
  }, [season]);
  const top = [...movers].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 4);
  return <><div className="section-heading"><div><div className="eyebrow">POSITION CHANGES</div><h2>Championship movers</h2></div><span className="data-chip">SINCE LAST VERIFIED ROUND</span></div><div className="movers-row glass-card">{top.length ? top.map((mover) => <article className="mover-item" key={mover.id}><span className={`mover-delta${mover.change < 0 ? ' down' : ''}`}>{mover.change > 0 ? '↑' : '↓'} {Math.abs(mover.change)}</span><div><strong>{mover.name}</strong><small>NOW P{mover.position}</small></div></article>) : <EmptyValue title="No position change available" detail="Movers appear after two verified rounds are available." />}</div></>;
}

function Standings({ season }: { season: number }) {
  const [drivers, setDrivers] = useState<Standing[]>([]);
  const [teams, setTeams] = useState<Standing[]>([]);
  const [positionChanges, setPositionChanges] = useState<Record<string, number>>({});
  const [progression, setProgression] = useState<Progression>({ series: [], rounds: [] });
  const [mode, setMode] = useState<'drivers' | 'constructors'>('drivers');
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getApi<Standing[]>(`/seasons/${season}/standings/${mode}`, controller.signal),
      getApi<Progression>(`/seasons/${season}/standings/${mode}/history`, controller.signal),
      mode === 'drivers' ? getApi<ChampionshipMover[]>(`/seasons/${season}/movers`, controller.signal) : Promise.resolve(null),
    ]).then(([standingData, historyData, moverData]) => {
      if (mode === 'drivers') setDrivers(standingData.data); else setTeams(standingData.data);
      setProgression(historyData.data);
      setPositionChanges(Object.fromEntries(moverData?.data.map((mover) => [mover.name, mover.change]) ?? []));
    }).catch(() => { if (mode === 'drivers') setDrivers([]); else setTeams([]); setProgression({ series: [], rounds: [] }); setPositionChanges({}); });
    return () => controller.abort();
  }, [season, mode]);
  const rows = mode === 'drivers' ? drivers : teams;
  const leaderPoints = rows[0]?.points ?? 0;
  return <PageHeader eyebrow={`${season} SEASON · VERIFIED RESULTS`} title="Championship standings" intro="Points earned across completed rounds. Driver and constructor titles are tracked separately." >
    <div className="table-card glass-card"><div className="table-toolbar"><div className="segmented" role="tablist" aria-label="Championship type"><button role="tab" aria-selected={mode === 'drivers'} onClick={() => setMode('drivers')}>Drivers</button><button role="tab" aria-selected={mode === 'constructors'} onClick={() => setMode('constructors')}>Constructors</button></div><span className="data-chip">{rows.length ? `${rows.length} CLASSIFIED` : 'NO VERIFIED DATA'}</span></div>
      {rows.length ? <div className="table-scroll"><table><thead><tr><th>POS</th><th>{mode === 'drivers' ? 'DRIVER' : 'CONSTRUCTOR'}</th><th>POINTS</th><th>GAP</th>{mode === 'drivers' && <th>CHANGE</th>}<th>WINS</th>{mode === 'drivers' && <th>PODIUMS</th>}</tr></thead><tbody>{rows.map((row) => { const gap = row.points - leaderPoints; const change = positionChanges[row.name] ?? 0; return <tr key={`${row.position}-${row.name}`}><td className="position">{String(row.position).padStart(2, '0')}</td><td><strong>{row.name}</strong>{row.team && <small>{row.team}</small>}</td><td className="points-cell">{row.points}</td><td>{gap === 0 ? 'Leader' : gap}</td>{mode === 'drivers' && <td className={change > 0 ? 'positive-change' : change < 0 ? 'negative-change' : ''}>{change > 0 ? `↑ ${change}` : change < 0 ? `↓ ${Math.abs(change)}` : '—'}</td>}<td>{row.wins ?? '—'}</td>{mode === 'drivers' && <td>{row.podiums ?? '—'}</td>}</tr>; })}</tbody></table></div> : <EmptyValue title="Standings are not available" detail="The backend has no verified standings for this season yet." />}
    </div>
    <section className="progression-panel glass-card" aria-labelledby="progression-title"><div className="section-heading compact"><div><div className="eyebrow">POINTS, ROUND BY ROUND</div><h2 id="progression-title">Championship progression</h2></div><span className="data-chip">TOP FIVE</span></div>
      {progression.rounds.length && progression.series.length ? <Suspense fallback={<EmptyValue title="Loading points progression" detail="The chart will appear shortly." />}><ProgressionChart progression={progression} /></Suspense> : <EmptyValue title="Round-by-round data is not available" detail="The chart appears when confirmed standings snapshots exist." />}
    </section>
    <div className="explainer glass-surface"><span className="explainer-mark">i</span><p><strong>Two titles, one grid.</strong> Drivers earn points for themselves and contribute points to their constructor. Scoring rules can change between seasons, so standings use the selected season's rules.</p></div>
  </PageHeader>;
}

function Races({ season, upcomingOnly = false }: { season: number; upcomingOnly?: boolean }) {
  const [races, setRaces] = useState<RaceSummary[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    getApi<RaceSummary[]>(`/seasons/${season}/calendar`, controller.signal).then(({ data }) => setRaces(data)).catch(() => setRaces([]));
    return () => controller.abort();
  }, [season]);
  const shown = upcomingOnly ? races.filter((race) => race.status === 'UPCOMING') : races;
  return <PageHeader eyebrow={`${season} SEASON · SCHEDULE & CLASSIFICATIONS`} title={upcomingOnly ? 'Race calendar' : 'Race results'} intro="Completed events and scheduled sessions, with source-confirmed details only.">
    <div className="race-list glass-card">{shown.length ? shown.map((race) => <article className="race-row" key={race.round}><span className="race-round">R{String(race.round).padStart(2, '0')}</span><div className="race-name"><h3>{race.name}</h3><p>{race.circuit ?? 'Circuit details unavailable'}{race.scheduleUpdatedAt && <span className="schedule-note"> · Schedule updated</span>}</p>{!upcomingOnly && race.status === 'COMPLETED' && <NavLink className="race-open-link" to={`/races/${race.round}`}>View classification <span>→</span></NavLink>}</div><div className="race-date">{race.scheduledStart ? new Date(race.scheduledStart).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'DATE TBC'}</div><span className={`race-state ${race.status.toLowerCase()}`}>{race.status === 'COMPLETED' ? 'CLASSIFIED' : race.status === 'UNKNOWN' ? 'UNVERIFIED' : race.status}</span></article>) : <EmptyValue title="Calendar data is not connected" detail="The schedule will appear here after a successful data import." />}</div>
  </PageHeader>;
}

function Directory({ kind, season }: { kind: 'Drivers' | 'Teams'; season: number }) {
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [teams, setTeams] = useState<DirectoryTeam[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    if (kind === 'Drivers') getApi<DirectoryPerson[]>(`/drivers?season=${season}`, controller.signal).then(({ data }) => setPeople(data)).catch(() => setPeople([]));
    else getApi<DirectoryTeam[]>(`/teams?season=${season}`, controller.signal).then(({ data }) => setTeams(data)).catch(() => setTeams([]));
    return () => controller.abort();
  }, [kind, season]);
  const count = kind === 'Drivers' ? people.length : teams.length;
  return <PageHeader eyebrow={`THE PEOPLE & THE TEAMS · ${season}`} title={kind} intro={`Explore ${kind.toLowerCase()} by season, with sourced details and championship context.`}>
    {count ? <div className="directory-grid">{kind === 'Drivers' ? people.map((person) => <NavLink key={person.id} to={`/drivers/${person.id}`} className="directory-card glass-card"><span className="directory-number">{person.number ?? '—'}</span><span className="eyebrow">{person.nationality ?? 'NATIONALITY UNAVAILABLE'}</span><h2>{person.name}</h2><p>{person.team ?? 'Team details unavailable'}</p><span className="directory-arrow">↗</span></NavLink>) : teams.map((team) => <NavLink key={team.id} to={`/teams/${team.id}`} className="directory-card glass-card"><span className="directory-number">T</span><span className="eyebrow">{team.nationality ?? 'NATIONALITY UNAVAILABLE'}</span><h2>{team.name}</h2><p>{team.drivers?.length ? team.drivers.join(' · ') : 'Driver details unavailable'}</p><span className="directory-arrow">↗</span></NavLink>)}</div> : <div className="coming-panel glass-card"><span className="coming-glyph">{kind === 'Drivers' ? 'D' : 'T'}</span><EmptyValue title={`${kind} directory is not connected`} detail="Profiles will use verified season and career data. No facts are filled in by guesswork." /></div>}
  </PageHeader>;
}

function DriverDetail({ season }: { season: number }) {
  const id = useLocation().pathname.split('/').pop() ?? '';
  const [driver, setDriver] = useState<DriverProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [career, setCareer] = useState<DriverCareer | null>(null);
  const [careerLoading, setCareerLoading] = useState(false);
  useEffect(() => { const controller = new AbortController(); setLoading(true); getApi<DriverProfileData>(`/drivers/${id}?season=${season}`, controller.signal).then(({ data }) => setDriver(data)).catch(() => setDriver(null)).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [id, season]);
  useEffect(() => {
    if (!driver) { setCareer(null); return; }
    const controller = new AbortController();
    setCareer(null); setCareerLoading(true);
    getApi<DriverCareer>(`/drivers/${id}/career`, controller.signal).then(({ data }) => setCareer(data)).catch(() => { if (!controller.signal.aborted) setCareer({ available: false, reason: 'Career statistics are temporarily unavailable from the historical source.' }); }).finally(() => { if (!controller.signal.aborted) setCareerLoading(false); });
    return () => controller.abort();
  }, [id, driver?.id]);
  return <PageHeader eyebrow={`${season} SEASON · DRIVER PROFILE`} title={driver?.name ?? 'Driver profile'} intro={driver ? `${driver.team ?? 'Team details unavailable'} · ${driver.nationality ?? 'Nationality unavailable'}` : 'Driver identity and season statistics are loaded from confirmed season records.'}>
    {loading ? <div className="coming-panel glass-card"><EmptyValue title="Loading driver profile" detail="Reading the selected season’s confirmed results." /></div> : !driver ? <div className="coming-panel glass-card"><EmptyValue title="Driver not available" detail="No sourced driver profile exists for this identifier and season." /></div> : <>
      <section className="driver-profile-identity glass-card"><span className="driver-profile-number">{driver.number ?? '—'}</span><div><div className="eyebrow">{driver.team ?? 'TEAM UNAVAILABLE'} · {driver.nationality ?? 'NATIONALITY UNAVAILABLE'}</div><h2>{driver.name}</h2><p>{season} season profile</p></div></section>
      <Suspense fallback={<div className="car-viewer-loading glass-card" role="status">Opening the garage…</div>}><TeamCarViewer teamName={driver.team ?? 'Formula 1'} season={season} /></Suspense>
      <section className="section-block driver-profile-section"><div className="section-heading"><div><div className="eyebrow">CONFIRMED SEASON RECORD</div><h2>Current-season statistics</h2></div>{driver.currentStats.available && <span className="data-chip">THROUGH R{driver.currentStats.throughRound}{driver.currentStats.throughRoundName ? ` · ${driver.currentStats.throughRoundName.toUpperCase()}` : ''}</span>}</div>
        {driver.currentStats.available ? <div className="driver-stat-grid">{[['CHAMPIONSHIP POSITION', driver.currentStats.position === null ? '—' : `P${driver.currentStats.position}`], ['POINTS', driver.currentStats.points ?? '—'], ['WINS', driver.currentStats.wins ?? '—'], ['PODIUMS', driver.currentStats.podiums ?? '—'], ['POLES', driver.currentStats.poles === null ? 'Not available' : driver.currentStats.poles]].map(([label, value]) => <article className="glass-card driver-stat-card" key={label}><span>{label}</span><strong>{value}</strong></article>)}</div> : <div className="glass-card driver-empty-panel"><EmptyValue title="Season statistics unavailable" detail="There are no confirmed standings for this driver and season yet." /></div>}
      </section>
      <section className="section-block driver-profile-section"><div className="section-heading"><div><div className="eyebrow">CAREER RECORD</div><h2>Career achievements</h2></div><span className="data-chip">SEPARATE FROM THIS SEASON</span></div>
        {careerLoading || !career ? <div className="glass-card driver-empty-panel"><EmptyValue title="Loading career record" detail="Fetching historical career totals." /></div> : career.available ? <><div className="driver-stat-grid">{[['WORLD CHAMPIONSHIPS', career.championships], ['RACE STARTS', career.starts], ['RACE WINS', career.wins], ['PODIUMS', career.podiums], ['POLE POSITIONS', career.poles], ['FASTEST LAPS', career.fastestLaps]].map(([label, value]) => <article className="glass-card driver-stat-card" key={label}><span>{label}</span><strong>{value}</strong></article>)}</div><p className="career-source-note">Career totals from <a href={career.sourceUrl} target="_blank" rel="noreferrer">RacingHub</a>, based on the <a href="https://github.com/f1db/f1db" target="_blank" rel="noreferrer">F1DB dataset</a> under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>.</p></> : <div className="glass-card driver-empty-panel"><EmptyValue title="Career achievements unavailable" detail={career.reason} /></div>}
      </section>
    </>}
  </PageHeader>;
}

function normalizeTeamLabel(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, ' ').trim();
}

interface ConstructorStandingRow { position: number; name: string; points: number; wins: number; }

function TeamShowroom({ season }: { season: number }) {
  const location = useLocation();
  const [teams, setTeams] = useState<DirectoryTeam[]>([]);
  const [drivers, setDrivers] = useState<DirectoryPerson[]>([]);
  const [constructorStandings, setConstructorStandings] = useState<ConstructorStandingRow[]>([]);
  const [driverStandings, setDriverStandings] = useState<Standing[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [teamLoadFailed, setTeamLoadFailed] = useState(false);
  const [standingsFailed, setStandingsFailed] = useState(false);
  const [throughRound, setThroughRound] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setTeamLoadFailed(false);
    setStandingsFailed(false);
    void Promise.allSettled([
      getApi<DirectoryTeam[]>(`/teams?season=${season}`, controller.signal),
      getApi<DirectoryPerson[]>(`/drivers?season=${season}`, controller.signal),
      getApi<ConstructorStandingRow[]>(`/seasons/${season}/standings/constructors`, controller.signal),
      getApi<Standing[]>(`/seasons/${season}/standings/drivers`, controller.signal),
    ]).then(([teamResult, driverResult, constructorResult, driverStandingResult]) => {
      if (controller.signal.aborted) return;
      if (teamResult.status === 'fulfilled') setTeams(teamResult.value.data);
      else { setTeams([]); setTeamLoadFailed(true); }
      setDrivers(driverResult.status === 'fulfilled' ? driverResult.value.data : []);
      if (constructorResult.status === 'fulfilled') {
        setConstructorStandings(constructorResult.value.data);
        setThroughRound(constructorResult.value.meta.throughRound);
      } else { setConstructorStandings([]); setStandingsFailed(true); }
      if (driverStandingResult.status === 'fulfilled') setDriverStandings(driverStandingResult.value.data);
      else setDriverStandings([]);
      setLoading(false);
    });
    return () => controller.abort();
  }, [season]);

  useEffect(() => {
    if (!teams.length) return;
    const requestedId = new URLSearchParams(location.search).get('team');
    setSelectedId((current) => {
      if (requestedId && teams.some((team) => team.id === requestedId)) return requestedId;
      if (teams.some((team) => team.id === current)) return current;
      return teams[0]!.id;
    });
  }, [teams, location.search]);

  const selectedTeam = teams.find((team) => team.id === selectedId) ?? null;
  const model = selectedTeam ? getTeamCarModel(selectedTeam.name) : null;
  const constructorStats = selectedTeam ? constructorStandings.find((row) => normalizeTeamLabel(row.name) === normalizeTeamLabel(selectedTeam.name)) : undefined;
  const roster = selectedTeam?.drivers ?? [];
  const rosterRows = roster.map((name) => {
    const driver = drivers.find((person) => normalizeTeamLabel(person.name) === normalizeTeamLabel(name));
    const standing = driverStandings.find((row) => normalizeTeamLabel(row.name) === normalizeTeamLabel(name) && (!row.team || !selectedTeam || normalizeTeamLabel(row.team) === normalizeTeamLabel(selectedTeam.name)));
    return { name, id: driver?.id, standing };
  });

  return <PageHeader eyebrow={`${season} SEASON · TEAM GARAGE`} title="Team showroom" intro="Choose a constructor to explore its local 3D car model and verified championship record.">
    {loading ? <div className="coming-panel glass-card"><EmptyValue title="Loading the team garage" detail="Reading constructor entries and confirmed standings." /></div> : teamLoadFailed || teams.length === 0 ? <div className="coming-panel glass-card"><EmptyValue title="Team data is unavailable" detail="The showroom could not load constructors from the connected API." /></div> : <div className="team-showroom-layout">
      <aside className="team-showroom-selector glass-card" aria-label="Choose a constructor">
        <div className="eyebrow">CONSTRUCTORS · {teams.length}</div>
        <div className="team-showroom-options">{teams.map((team) => {
          const hasModel = Boolean(getTeamCarModel(team.name));
          return <button key={team.id} className={`team-showroom-option${team.id === selectedTeam?.id ? ' is-selected' : ''}`} aria-pressed={team.id === selectedTeam?.id} onClick={() => setSelectedId(team.id)}>
            <span className="team-showroom-mark" aria-hidden="true">{team.name.slice(0, 1)}</span>
            <span className="team-showroom-option-copy"><strong>{team.name}</strong><small>{hasModel ? 'LOCAL 3D MODEL' : 'TEAM DATA ONLY'}</small></span>
            <span className="team-showroom-chevron" aria-hidden="true">›</span>
          </button>;
        })}</div>
      </aside>
      {selectedTeam && <div className="team-showroom-detail">
        <Suspense fallback={<div className="car-viewer-loading glass-card" role="status">Opening the garage…</div>}><TeamCarViewer
          teamName={selectedTeam.name}
          season={season}
          modelUrl={model ? getTeamCarModelUrl(model) : null}
          modelNote={model ? `${model.displayName} · Local project asset (${model.archive}). Community 3D visualization; not an official Formula 1 or FIA model.` : undefined}
        /></Suspense>
        <section className="team-showroom-info glass-card">
          <div className="team-showroom-title-row"><div><div className="eyebrow">{selectedTeam.nationality ?? 'CONSTRUCTOR'} · {season} CONSTRUCTOR</div><h2>{selectedTeam.name}</h2></div><NavLink className="button-secondary team-profile-link" to={`/teams/${selectedTeam.id}`}>Team profile ↗</NavLink></div>
          {constructorStats ? <>
            <div className="team-showroom-stat-grid"><article><span>CHAMPIONSHIP POSITION</span><strong>P{constructorStats.position}</strong></article><article><span>POINTS</span><strong>{constructorStats.points}</strong></article><article><span>RACE WINS</span><strong>{constructorStats.wins}</strong></article></div>
            <p className="team-showroom-through">Confirmed through round {throughRound || '—'}</p>
          </> : <div className="team-showroom-stat-empty"><EmptyValue title={standingsFailed ? 'Standings are unavailable' : 'No confirmed constructor standings'} detail="Team and driver information remains available while standings are unavailable." /></div>}
          <div className="team-showroom-roster"><div className="eyebrow">DRIVERS · {rosterRows.length}</div>
            {rosterRows.length ? <div className="team-showroom-drivers">{rosterRows.map(({ name, id, standing }) => <div className="team-showroom-driver" key={name}>
              {id ? <NavLink to={`/drivers/${id}`}>{name}</NavLink> : <strong>{name}</strong>}
              <span>{standing ? `P${standing.position} · ${standing.points} PTS` : 'Standing unavailable'}</span>
            </div>)}</div> : <p className="team-showroom-muted">No current-season drivers are attached to this constructor.</p>}
          </div>
        </section>
      </div>}
    </div>}
  </PageHeader>;
}

function TeamDetail({ season }: { season: number }) {
  const id = useLocation().pathname.split('/').pop() ?? '';
  const [team, setTeam] = useState<DirectoryTeam | null>(null);
  const teamModel = team ? getTeamCarModel(team.name) : null;
  const teamName = team?.name ?? id.split(/[-_]/).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join(' ');
  useEffect(() => { const controller = new AbortController(); getApi<DirectoryTeam>(`/teams/${id}?season=${season}`, controller.signal).then(({ data }) => setTeam(data)).catch(() => setTeam(null)); return () => controller.abort(); }, [id, season]);
  return <PageHeader eyebrow={`${season} SEASON · CONSTRUCTOR PROFILE`} title={teamName || 'Team profile'} intro={team?.drivers?.length ? `Current drivers · ${team.drivers.join(' and ')}` : team ? 'Team details and season statistics will appear when verified data is available.' : 'Team data is unavailable right now; a generic concept model is still available below.'}>
    {id && <Suspense fallback={<div className="car-viewer-loading glass-card" role="status">Opening the garage…</div>}><TeamCarViewer teamName={teamName || 'Formula 1'} season={season} modelUrl={team ? (teamModel ? getTeamCarModelUrl(teamModel) : null) : null} modelNote={teamModel ? `${teamModel.displayName} · Local project asset (${teamModel.archive}). Community 3D visualization; not an official Formula 1 or FIA model.` : undefined} /></Suspense>}
    {team?.currentStats.available ? <section className="team-profile-section"><div className="section-heading"><div><div className="eyebrow">CONFIRMED SEASON RECORD</div><h2>Current-season statistics</h2></div><span className="data-chip">THROUGH R{team.currentStats.throughRound}{team.currentStats.throughRoundName ? ` · ${team.currentStats.throughRoundName.toUpperCase()}` : ''}</span></div><div className="driver-stat-grid"><article className="glass-card driver-stat-card"><span>CONSTRUCTOR POSITION</span><strong>P{team.currentStats.position}</strong></article><article className="glass-card driver-stat-card"><span>POINTS</span><strong>{team.currentStats.points}</strong></article><article className="glass-card driver-stat-card"><span>WINS</span><strong>{team.currentStats.wins}</strong></article></div></section> : <div className="coming-panel glass-card"><span className="coming-glyph">T</span><EmptyValue title={team ? 'Season statistics unavailable' : 'Team not available'} detail="Season position and achievements will be shown when reliable source data is available." /></div>}
  </PageHeader>;
}

type AdminValidation = {
  season: number;
  ruleset: string | null;
  coverage: { scheduleRounds: number; raceResults: number; sprintResults: number; qualifyingResults: number; pitStopRecords: number };
  rounds: Array<{ round: number; name: string; isSprint: boolean; hasRaceResults: boolean; hasSprintResults: boolean }>;
  checks: Array<{ round: number; session: string; resultCount: number; missingPositions: number; duplicatePositions: number[]; pointsMatch: boolean }>;
  issues: Array<{ round: number; session: string; missingPositions: number; duplicatePositions: number[]; pointsMatch: boolean }>;
  unsupportedRuleSet: boolean;
};
type AdminAudit = { id: string; actor: string; action: string; entityType: string; entityId: string; createdAt: string; };
type AdminOverride = { id: string; entityType: string; entityId: string; reason: string; createdAt: string; };
type AdminResultRow = { id: string; session: string; driverId: string; driver: string; constructor: string; gridPosition: number | null; finishPosition: number | null; status: string | null; points: number; };
const adminReasons = [
  ['source_correction', 'Source correction'], ['missing_provider_record', 'Missing provider record'], ['official_correction', 'Official correction'], ['classification_update', 'Classification update'], ['recap_source_update', 'Recap source update'],
] as const;

function AdminPage({ season }: { season: number }) {
  const [auth, setAuth] = useState<'CHECKING' | 'SIGNED_OUT' | 'ACTIVE' | 'DISABLED'>('CHECKING');
  const [accessKey, setAccessKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusRows, setStatusRows] = useState<Array<{ seasonYear: number; throughRound: number; stale: boolean; lastError: string | null; updatedAt: string | null }>>([]);
  const [validation, setValidation] = useState<AdminValidation | null>(null);
  const [audit, setAudit] = useState<AdminAudit[]>([]);
  const [overrides, setOverrides] = useState<AdminOverride[]>([]);
  const [drivers, setDrivers] = useState<DirectoryPerson[]>([]);
  const [results, setResults] = useState<AdminResultRow[]>([]);
  const [round, setRound] = useState(0);
  const [resultId, setResultId] = useState('');
  const [session, setSession] = useState<'RACE' | 'SPRINT'>('RACE');
  const [driverId, setDriverId] = useState('');
  const [gridPosition, setGridPosition] = useState('');
  const [finishPosition, setFinishPosition] = useState('1');
  const [resultStatus, setResultStatus] = useState('Finished');
  const [sourceUrl, setSourceUrl] = useState('https://github.com/jolpica/jolpica-f1');
  const [reason, setReason] = useState<(typeof adminReasons)[number][0]>('source_correction');
  const [qualifyingPosition, setQualifyingPosition] = useState('1');
  const [recapKind, setRecapKind] = useState<'FACT' | 'INTERPRETATION'>('FACT');
  const [recapCategory, setRecapCategory] = useState('RESULT');
  const [recapBody, setRecapBody] = useState('');
  const [recapSourceLabel, setRecapSourceLabel] = useState('Official source');
  const [refreshStatus, setRefreshStatus] = useState<{ status: string; phase: string; message?: string } | null>(null);
  const activeRound = validation?.rounds.find((item) => item.round === round);
  const selectedResult = results.find((item) => item.id === resultId);

  useEffect(() => {
    const controller = new AbortController();
    getAdmin<{ authenticated: boolean }>('/admin/session', controller.signal).then(() => setAuth('ACTIVE')).catch((failure: unknown) => {
      const message = failure instanceof Error ? failure.message : '';
      setAuth(message.toLowerCase().includes('disabled') || message.toLowerCase().includes('configured') ? 'DISABLED' : 'SIGNED_OUT');
    });
    return () => controller.abort();
  }, []);

  const loadData = () => {
    const controller = new AbortController();
    Promise.all([
      getAdmin<typeof statusRows>('/admin/status', controller.signal),
      getAdmin<AdminValidation>(`/admin/validation/${season}`, controller.signal),
      getAdmin<AdminAudit[]>('/admin/audit?limit=30', controller.signal),
      getAdmin<AdminOverride[]>('/admin/overrides?limit=30', controller.signal),
      getApi<DirectoryPerson[]>(`/drivers?season=${season}&limit=100`, controller.signal),
      getAdmin<{ status: string; phase: string; message?: string }>(`/admin/refresh/${season}`, controller.signal),
    ]).then(([statuses, report, auditRows, overrideRows, driverRows, refresh]) => {
      setStatusRows(statuses); setValidation(report); setAudit(auditRows); setOverrides(overrideRows); setDrivers(driverRows.data); setRefreshStatus(refresh);
      const through = statuses.find((item) => item.seasonYear === season)?.throughRound ?? 0;
      setRound((selected) => report.rounds.some((item) => item.round === selected) ? selected : (through || report.rounds.at(-1)?.round || 0));
      setError('');
    }).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Admin data could not be loaded.'));
    return () => controller.abort();
  };

  useEffect(() => { if (auth === 'ACTIVE') return loadData(); }, [auth, season]);
  useEffect(() => {
    if (auth !== 'ACTIVE' || !round) return;
    const controller = new AbortController();
    getAdmin<AdminResultRow[]>(`/admin/seasons/${season}/races/${round}/results`, controller.signal).then((items) => {
      setResults(items); setResultId((current) => items.some((item) => item.id === current) ? current : items[0]?.id ?? '');
    }).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Event results could not be loaded.'));
    return () => controller.abort();
  }, [auth, season, round]);
  useEffect(() => {
    if (!selectedResult) return;
    setSession(selectedResult.session === 'SPRINT' ? 'SPRINT' : 'RACE'); setDriverId(selectedResult.driverId);
    setGridPosition(selectedResult.gridPosition === null ? '' : String(selectedResult.gridPosition)); setFinishPosition(selectedResult.finishPosition === null ? '' : String(selectedResult.finishPosition)); setResultStatus(selectedResult.status ?? 'Finished');
  }, [selectedResult]);

  const login = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    try { await sendAdmin('/admin/session', 'POST', { accessKey }); setAccessKey(''); setAuth('ACTIVE'); }
    catch (failure) { const message = failure instanceof Error ? failure.message : 'Admin session could not be started.'; setError(message); setAuth(message.toLowerCase().includes('disabled') || message.toLowerCase().includes('configured') ? 'DISABLED' : 'SIGNED_OUT'); }
  };
  const signOut = async () => { await sendAdmin('/admin/session', 'DELETE').catch(() => undefined); setAuth('SIGNED_OUT'); setStatusRows([]); setValidation(null); setAudit([]); setOverrides([]); setResults([]); };
  const refresh = async () => { setError(''); setNotice(''); try { const job = await sendAdmin<{ status: string; phase: string }>(`/admin/refresh/${season}`, 'POST'); setRefreshStatus(job); setNotice('Refresh queued. It runs against the configured Jolpica-F1 provider; no visitor data is sent.'); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Refresh could not be started.'); } };
  const updateResult = async (event: React.FormEvent) => {
    event.preventDefault(); if (!selectedResult) return;
    try {
      await sendAdmin(`/admin/results/${selectedResult.id}`, 'PATCH', { gridPosition: gridPosition ? Number(gridPosition) : null, finishPosition: finishPosition ? Number(finishPosition) : null, status: resultStatus, sourceUrl, reason });
      setNotice('Classification updated and standings recalculated.'); await loadData();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Result correction failed.'); }
  };
  const addResult = async (event: React.FormEvent) => {
    event.preventDefault(); if (!round || !driverId) return;
    try {
      await sendAdmin(`/admin/seasons/${season}/races/${round}/results/${session}/${driverId}`, 'PUT', { gridPosition: gridPosition ? Number(gridPosition) : null, finishPosition: Number(finishPosition), status: resultStatus, sourceUrl, reason });
      setNotice('Result saved and standings recalculated.'); await loadData();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Result entry failed.'); }
  };
  const addQualifying = async (event: React.FormEvent) => {
    event.preventDefault(); if (!round || !driverId) return;
    try {
      await sendAdmin(`/admin/seasons/${season}/races/${round}/qualifying`, 'POST', { results: [{ driverId, position: Number(qualifyingPosition) }], sourceUrl, reason });
      setNotice('Qualifying result saved with its source and audit record.'); await loadData();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Qualifying entry failed.'); }
  };
  const addRecap = async (event: React.FormEvent) => {
    event.preventDefault(); if (!round) return;
    try {
      await sendAdmin(`/admin/seasons/${season}/races/${round}/recaps`, 'POST', { kind: recapKind, category: recapCategory, body: recapBody, sourceUrl, sourceLabel: recapSourceLabel, reason });
      setRecapBody(''); setNotice('Sourced recap entry added and audited.'); await loadData();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Recap entry failed.'); }
  };
  const revert = async (overrideId: string) => {
    try { await sendAdmin(`/admin/overrides/${overrideId}/revert`, 'POST', { reason: 'official_correction' }); setNotice('Override reverted and recorded in the audit history.'); await loadData(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Rollback failed.'); }
  };

  if (auth === 'CHECKING') return <PageHeader eyebrow="OPERATIONS · PRIVATE" title="Admin maintenance" intro="Checking whether this installation has admin maintenance enabled."><div className="coming-panel glass-card"><EmptyValue title="Checking admin session" detail="No visitor profile or visitor session is created." /></div></PageHeader>;
  if (auth !== 'ACTIVE') return <PageHeader eyebrow="OPERATIONS · PRIVATE" title="Admin maintenance" intro="This area is not in public navigation. It uses a single environment-configured maintenance key and does not ask for an email, username, or profile."><div className="admin-login glass-card">{auth === 'DISABLED' ? <EmptyValue title="Admin maintenance is not configured" detail="Set ADMIN_ACCESS_KEY and a production JWT_SECRET in the backend environment, then restart the backend." /> : <form onSubmit={(event) => void login(event)}><label>Maintenance access key<input type="password" autoComplete="off" minLength={32} value={accessKey} onChange={(event) => setAccessKey(event.target.value)} required /></label><button className="button-primary" type="submit">Open maintenance tools <span>→</span></button></form>}{error && <div className="inline-notice" role="alert">{error}</div>}</div></PageHeader>;

  const currentStatus = statusRows.find((item) => item.seasonYear === season);
  return <PageHeader eyebrow="OPERATIONS · PRIVATE" title="Admin maintenance" intro="Review validation, refresh public championship data, and correct sourced records. Access keys and admin identities are not stored in the database.">
    <div className="admin-toolbar glass-card"><div><span className="eyebrow">MAINTENANCE SESSION</span><p>Configured admin · no personal identity attached</p></div><div className="admin-toolbar-actions"><button className="button-secondary" onClick={() => void loadData()}>Refresh report</button><button className="button-secondary" onClick={() => void signOut()}>End session</button></div></div>
    {error && <div className="inline-notice" role="alert">{error}</div>}{notice && <div className="explainer glass-surface" role="status"><span className="explainer-mark">✓</span><p>{notice}</p></div>}
    <section className="section-block admin-overview"><div className="section-heading"><div><div className="eyebrow">DATA OPERATIONS</div><h2>Season validation</h2></div><span className="data-chip">{currentStatus?.stale ? 'STALE DATA' : 'CURRENT DATA'}</span></div>
      <div className="admin-coverage glass-card"><div><span>ROUNDS</span><strong>{validation?.coverage.scheduleRounds ?? '—'}</strong></div><div><span>RACE RESULTS</span><strong>{validation?.coverage.raceResults ?? '—'}</strong></div><div><span>SPRINT RESULTS</span><strong>{validation?.coverage.sprintResults ?? '—'}</strong></div><div><span>QUALIFYING</span><strong>{validation?.coverage.qualifyingResults ?? '—'}</strong></div><div><span>VALIDATION ISSUES</span><strong>{validation?.issues.length ?? '—'}</strong></div></div>
      {currentStatus?.lastError && <div className="inline-notice" role="status">{currentStatus.lastError}</div>}
      {validation?.unsupportedRuleSet && <div className="inline-notice" role="status">No verified scoring ruleset is available for {season}; scoring-sensitive corrections are disabled.</div>}
      <div className="admin-action-row"><button className="button-primary" onClick={() => void refresh()} disabled={validation?.unsupportedRuleSet}>Refresh schedule and results <span>↻</span></button><span className="data-chip">{refreshStatus?.phase ?? 'NO REFRESH RUN THIS SESSION'}</span><span className="data-chip">{validation?.ruleset ?? 'RULESET UNAVAILABLE'}</span></div>
      {!!validation?.issues.length && <div className="admin-issues glass-card"><div className="eyebrow">NEEDS REVIEW</div>{validation.issues.map((issue, index) => <p key={`${issue.round}-${issue.session}-${index}`}>R{issue.round} · {issue.session}: {issue.missingPositions ? `${issue.missingPositions} missing positions; ` : ''}{issue.duplicatePositions.length ? `duplicate places ${issue.duplicatePositions.join(', ')}; ` : ''}{!issue.pointsMatch ? 'scoring mismatch' : ''}</p>)}</div>}
    </section>
    <section className="section-block admin-editor"><div className="section-heading"><div><div className="eyebrow">SOURCED CORRECTIONS</div><h2>Event records</h2></div><label className="admin-select-label">ROUND<select value={round || ''} onChange={(event) => setRound(Number(event.target.value))}>{validation?.rounds.map((item) => <option key={item.round} value={item.round}>R{item.round} · {item.name}</option>)}</select></label></div>
      <div className="admin-form-grid">
        <form className="admin-form glass-card" onSubmit={(event) => void updateResult(event)}><div className="eyebrow">CORRECT CLASSIFICATION</div><label>Stored result<select value={resultId} onChange={(event) => setResultId(event.target.value)}>{results.map((item) => <option key={item.id} value={item.id}>{item.session} · {item.driver} · P{item.finishPosition ?? '—'}</option>)}</select></label><div className="admin-field-row"><label>Grid<input type="number" min="1" max="40" value={gridPosition} onChange={(event) => setGridPosition(event.target.value)} /></label><label>Finish<input type="number" min="1" max="40" value={finishPosition} onChange={(event) => setFinishPosition(event.target.value)} /></label></div><label>Status<input value={resultStatus} onChange={(event) => setResultStatus(event.target.value)} /></label><SourceAndReason sourceUrl={sourceUrl} setSourceUrl={setSourceUrl} reason={reason} setReason={setReason} /><button className="button-primary" type="submit" disabled={!selectedResult || validation?.unsupportedRuleSet}>Correct and recalculate <span>→</span></button></form>
        <form className="admin-form glass-card" onSubmit={(event) => void addResult(event)}><div className="eyebrow">ENTER EVENT RESULT</div><label>Session<select value={session} onChange={(event) => setSession(event.target.value as 'RACE' | 'SPRINT')}><option value="RACE">Grand Prix</option>{activeRound?.isSprint && <option value="SPRINT">Sprint</option>}</select></label><label>Driver<select value={driverId} onChange={(event) => setDriverId(event.target.value)}>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></label><div className="admin-field-row"><label>Grid<input type="number" min="1" max="40" value={gridPosition} onChange={(event) => setGridPosition(event.target.value)} /></label><label>Finish<input type="number" min="1" max="40" value={finishPosition} onChange={(event) => setFinishPosition(event.target.value)} /></label></div><label>Status<input value={resultStatus} onChange={(event) => setResultStatus(event.target.value)} /></label><SourceAndReason sourceUrl={sourceUrl} setSourceUrl={setSourceUrl} reason={reason} setReason={setReason} /><button className="button-primary" type="submit" disabled={!activeRound || validation?.unsupportedRuleSet}>Save result <span>+</span></button></form>
        <form className="admin-form glass-card" onSubmit={(event) => void addQualifying(event)}><div className="eyebrow">ENTER QUALIFYING RESULT</div><label>Driver<select value={driverId} onChange={(event) => setDriverId(event.target.value)}>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></label><label>Qualifying position<input type="number" min="1" max="40" value={qualifyingPosition} onChange={(event) => setQualifyingPosition(event.target.value)} required /></label><SourceAndReason sourceUrl={sourceUrl} setSourceUrl={setSourceUrl} reason={reason} setReason={setReason} /><button className="button-primary" type="submit">Save qualifying <span>+</span></button></form>
        <form className="admin-form glass-card" onSubmit={(event) => void addRecap(event)}><div className="eyebrow">SOURCE A RECAP ENTRY</div><label>Entry type<select value={recapKind} onChange={(event) => setRecapKind(event.target.value as 'FACT' | 'INTERPRETATION')}><option value="FACT">Sourced fact</option><option value="INTERPRETATION">Interpretation</option></select></label><label>Category<input value={recapCategory} onChange={(event) => setRecapCategory(event.target.value.toUpperCase())} maxLength={60} required /></label><label>Recap text<textarea value={recapBody} onChange={(event) => setRecapBody(event.target.value)} minLength={10} maxLength={1400} rows={4} required /></label><label>Source label<input value={recapSourceLabel} onChange={(event) => setRecapSourceLabel(event.target.value)} required /></label><SourceAndReason sourceUrl={sourceUrl} setSourceUrl={setSourceUrl} reason={reason} setReason={setReason} /><button className="button-primary" type="submit">Add sourced entry <span>+</span></button></form>
      </div>
    </section>
    <section className="section-block admin-history-grid"><article className="glass-card admin-history"><div className="section-heading compact"><div><div className="eyebrow">CHANGE HISTORY</div><h2>Audit log</h2></div></div>{audit.length ? audit.slice(0, 12).map((entry) => <div className="admin-history-row" key={entry.id}><strong>{entry.action.replaceAll('_', ' ')}</strong><span>{entry.entityType} · {entry.entityId}</span><time>{new Date(entry.createdAt).toLocaleString()}</time></div>) : <EmptyValue title="No maintenance changes" detail="Actions appear here after a sourced change is submitted." />}</article><article className="glass-card admin-history"><div className="section-heading compact"><div><div className="eyebrow">REVERSIBLE OVERRIDES</div><h2>Rollback</h2></div></div>{overrides.length ? overrides.map((item) => <div className="admin-history-row" key={item.id}><strong>{item.entityType}</strong><span>{item.reason.replaceAll('_', ' ')} · {item.entityId}</span><button className="button-secondary" onClick={() => void revert(item.id)}>Revert</button></div>) : <EmptyValue title="No active overrides" detail="Manual corrections can be rolled back while no later change has replaced that record." />}</article></section>
  </PageHeader>;
}

function SourceAndReason({ sourceUrl, setSourceUrl, reason, setReason }: { sourceUrl: string; setSourceUrl: (value: string) => void; reason: (typeof adminReasons)[number][0]; setReason: (value: (typeof adminReasons)[number][0]) => void }) {
  return <><label>Source URL<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} required /></label><label>Reason<select value={reason} onChange={(event) => setReason(event.target.value as (typeof adminReasons)[number][0])}>{adminReasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></>;
}

function RaceDetail({ season }: { season: number }) {
  const round = Number(useLocation().pathname.split('/').pop());
  const [race, setRace] = useState<RaceDetailData | null>(null);
  const [analysis, setAnalysis] = useState<RaceAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState(false);
  const [tab, setTab] = useState<'results' | 'recap' | 'analysis'>('results');
  useEffect(() => { const controller = new AbortController(); getApi<RaceDetailData>(`/seasons/${season}/races/${round}`, controller.signal).then(({ data }) => setRace(data)).catch(() => setRace(null)); return () => controller.abort(); }, [season, round]);
  useEffect(() => { if (tab !== 'analysis') return; const controller = new AbortController(); setAnalysisError(false); getApi<RaceAnalysis>(`/seasons/${season}/races/${round}/analysis`, controller.signal).then(({ data }) => setAnalysis(data)).catch(() => setAnalysisError(true)); return () => controller.abort(); }, [season, round, tab]);
  return <PageHeader eyebrow={`${season} SEASON · ROUND ${round}`} title={race?.name ?? 'Grand Prix'} intro={race?.circuit ?? 'Circuit details unavailable'}>
    <div className="race-detail-tabs" role="tablist" aria-label="Race detail sections"><button role="tab" aria-selected={tab === 'results'} onClick={() => setTab('results')}>Results</button><button role="tab" aria-selected={tab === 'recap'} onClick={() => setTab('recap')}>Recap</button><button role="tab" aria-selected={tab === 'analysis'} onClick={() => setTab('analysis')}>Analysis</button></div>
    {tab === 'results' && <section role="tabpanel" className="race-detail-panel" aria-label="Race results">{race?.results.length ? <><RaceResultsTable title="Grand Prix classification" results={race.results} />{race.sprintResults.length > 0 && <RaceResultsTable title="Sprint classification" results={race.sprintResults} />}</> : <div className="coming-panel glass-card"><span className="coming-glyph">R{round}</span><EmptyValue title="Official results are not available" detail="This race does not yet have a verified classification in the connected data." /></div>}</section>}
    {tab === 'recap' && <section role="tabpanel" className="recap-list" aria-label="Race recap">{race?.recap.available ? <>{!race.recap.narrativeAvailable && <div className="explainer glass-surface"><span className="explainer-mark">i</span><p><strong>Classification facts only.</strong> Highlights below are derived from the verified result and starting-grid data. No race incidents or narrative interpretation have been added.{race.recap.unsupportedEntryCount > 0 ? ' Unsourced draft text is withheld.' : ''}</p></div>}{race.recap.entries.map((entry, index) => <article className="recap-entry glass-card" key={`${entry.category}-${index}`}><div className="eyebrow">{entry.kind === 'FACT' ? 'SOURCED FACT' : 'INTERPRETATION'} · {entry.category}</div><p>{entry.body}</p><a href={entry.sourceUrl} target="_blank" rel="noreferrer" className="text-link">{entry.sourceLabel ?? 'Open source'} <span>↗</span></a></article>)}</> : <div className="coming-panel glass-card"><span className="coming-glyph">R{round}</span><EmptyValue title="No sourced recap is available" detail={race?.recap.unsupportedEntryCount ? 'Draft recap text without a source is withheld. A recap will appear when its claims can be attributed.' : 'A race recap will appear when sourced facts and any interpretation have been reviewed and added.'} /></div>}</section>}
    {tab === 'analysis' && <section role="tabpanel" className="race-analysis" aria-label="Race analysis">{analysisError ? <div className="inline-notice" role="status">Race analysis could not load. Try again in a moment.</div> : !analysis ? <div className="coming-panel glass-card"><EmptyValue title="Loading verified race data" detail="Derived comparisons appear when this event’s stored results are available." /></div> : <>
      <article className="analysis-card glass-card"><div className="eyebrow">GRID TO FINISH</div><h2>Positions gained and lost</h2><p className="analysis-method">{analysis.positions.method}</p>{analysis.positions.available ? <div className="table-scroll"><table><thead><tr><th>DRIVER</th><th>GRID</th><th>FINISH</th><th>CHANGE</th></tr></thead><tbody>{analysis.positions.rows.map((row) => <tr key={row.driverId}><td><strong>{row.driver}</strong></td><td>{row.gridPosition ?? 'Unavailable'}</td><td>{row.finishPosition ?? 'Unclassified'}</td><td>{row.label}</td></tr>)}</tbody></table></div> : <EmptyValue title="Grid-to-finish analysis unavailable" detail="No stored race classification is available for this event." />}</article>
      <div className="analysis-subgrid"><article className="analysis-card glass-card"><div className="eyebrow">QUALIFYING VS RACE</div><h2>Starting pace and finish</h2>{analysis.qualifyingVsRace.available ? <div className="table-scroll"><table><thead><tr><th>DRIVER</th><th>QUALI</th><th>FINISH</th><th>CHANGE</th></tr></thead><tbody>{analysis.qualifyingVsRace.rows.map((row) => <tr key={row.driverId}><td><strong>{row.driver}</strong></td><td>P{row.qualifyingPosition}</td><td>P{row.finishPosition}</td><td>{row.positionsChange > 0 ? `Gained ${row.positionsChange}` : row.positionsChange < 0 ? `Lost ${Math.abs(row.positionsChange)}` : 'No change'}</td></tr>)}</tbody></table></div> : <EmptyValue title="Qualifying comparison unavailable" detail={analysis.qualifyingVsRace.reason ?? 'No matched qualifying and race results are stored.'} />}</article>
        <article className="analysis-card glass-card"><div className="eyebrow">TEAMMATE BATTLE</div><h2>Race head-to-head</h2><p className="analysis-method">{analysis.teammateBattles.method}</p>{analysis.teammateBattles.available ? <div className="h2h-list">{analysis.teammateBattles.rows.map((battle) => <div className="h2h-row" key={battle.team}><span>{battle.team}</span><strong>{battle.driverA} <small>P{battle.finishA}</small></strong><b>VS</b><strong>{battle.driverB} <small>P{battle.finishB}</small></strong><em>{battle.outcome === 'TIED' ? 'Tied' : battle.outcome === 'DRIVER_A_AHEAD' ? `${battle.driverA} ahead` : `${battle.driverB} ahead`}</em></div>)}</div> : <EmptyValue title="Teammate comparison unavailable" detail="Both teammates need a stored classified result in the event." />}</article></div>
      <article className="analysis-card glass-card"><div className="eyebrow">PIT-STOP PERFORMANCE</div><h2>Stop records</h2>{analysis.pitStops.available ? <p className="analysis-method">{analysis.pitStops.recordCount} validated records available.</p> : <EmptyValue title="Pit-stop analysis unavailable" detail={analysis.pitStops.reason ?? 'Reliable pit-stop data is not stored for this event.'} />}</article>
    </>}</section>}
  </PageHeader>;
}

function RaceResultsTable({ title, results }: { title: string; results: RaceDetailData['results'] }) {
  return <section className="table-card glass-card race-results-panel"><div className="section-heading compact"><h2>{title}</h2><span className="data-chip">VERIFIED CLASSIFICATION</span></div><div className="table-scroll"><table><thead><tr><th>POS</th><th>DRIVER</th><th>TEAM</th><th>POINTS</th><th>STATUS</th></tr></thead><tbody>{results.map((result, index) => <tr key={`${result.driver}-${index}`}><td className="position">{result.position ?? '—'}</td><td><strong>{result.driver}</strong></td><td>{result.constructor}</td><td className="points-cell">{result.points}</td><td>{result.status ?? 'Classified'}</td></tr>)}</tbody></table></div></section>;
}

function InfoPage({ title, eyebrow, copy }: { title: string; eyebrow: string; copy: string }) {
  return <PageHeader eyebrow={eyebrow} title={title} intro={copy}><div className="coming-panel glass-card"><span className="coming-glyph">✳</span><EmptyValue title="Built around trustworthy data" detail="This section is part of the project roadmap and will be filled with sourced, season-aware information." /></div></PageHeader>;
}

function CalculatorPage({ season }: { season: number }) {
  const [summary, setSummary] = useState<CalculatorSummary | null>(null);
  const [prediction, setPrediction] = useState<PredictionEstimate | null>(null);
  const [predictionLoading, setPredictionLoading] = useState(true);
  const [level, setLevel] = useState<1 | 2 | 3>(1);
  const [assignments, setAssignments] = useState<ScenarioRoundInput[]>([]);
  const [projection, setProjection] = useState<ScenarioProjection | null>(null);
  const [roundNumber, setRoundNumber] = useState<number | null>(null);
  const [session, setSession] = useState<'RACE' | 'SPRINT'>('RACE');
  const [driverId, setDriverId] = useState('');
  const [position, setPosition] = useState(1);
  const [error, setError] = useState('');
  const [shareLink, setShareLink] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setSummary(null); setProjection(null); setError('');
    getApi<CalculatorSummary>(`/seasons/${season}/calculator/summary`, controller.signal).then(({ data }) => {
      setSummary(data); setRoundNumber((current) => data.remainingRounds.some((round) => round.round === current) ? current : data.remainingRounds[0]?.round ?? null); setDriverId(data.contenders[0]?.id ?? '');
      const encoded = new URLSearchParams(window.location.search).get('scenario');
      if (encoded) { try { const decoded = JSON.parse(atob(encoded)) as ScenarioRoundInput[]; if (Array.isArray(decoded) && decoded.length <= 30) setAssignments(decoded); } catch { setError('The shared scenario link is invalid.'); } }
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Calculator data is unavailable.'); });
    return () => controller.abort();
  }, [season]);
  useEffect(() => {
    const controller = new AbortController();
    setPrediction(null); setPredictionLoading(true);
    getApi<PredictionEstimate>(`/seasons/${season}/predictions`, controller.signal).then(({ data }) => setPrediction(data)).catch(() => setPrediction(null)).finally(() => { if (!controller.signal.aborted) setPredictionLoading(false); });
    return () => controller.abort();
  }, [season]);
  const selectedRound = summary?.remainingRounds.find((round) => round.round === roundNumber);
  const selectedSessionFinishes = (assignment: ScenarioRoundInput) => session === 'RACE' ? assignment.raceFinishes : (assignment.sprintFinishes ?? []);
  const addFinish = () => {
    if (!summary || !selectedRound || !driverId) return;
    const current = assignments.find((assignment) => assignment.round === selectedRound.round) ?? { round: selectedRound.round, raceFinishes: [], sprintFinishes: [] };
    const finishes = selectedSessionFinishes(current);
    if (finishes.some((finish) => finish.driverId === driverId)) { setError('This driver already has a finishing position in that session.'); return; }
    if (finishes.some((finish) => finish.position === position)) { setError(`Position ${position} is already assigned in that session.`); return; }
    const next: ScenarioRoundInput = session === 'RACE' ? { ...current, raceFinishes: [...current.raceFinishes, { driverId, position }] } : { ...current, sprintFinishes: [...(current.sprintFinishes ?? []), { driverId, position }] };
    setAssignments((items) => [...items.filter((item) => item.round !== next.round), next].sort((a, b) => a.round - b.round)); setError(''); setProjection(null); setShareLink('');
  };
  const calculate = async () => {
    if (!summary) return;
    try { const result = await postApi<ScenarioProjection>(`/seasons/${season}/calculator/scenario`, { rounds: assignments }); setProjection(result.data); setError(''); }
    catch (reason) { setProjection(null); setError(reason instanceof Error ? reason.message : 'Scenario could not be calculated.'); }
  };
  const reset = () => { setAssignments([]); setProjection(null); setError(''); setShareLink(''); window.history.replaceState(null, '', window.location.pathname); };
  const share = async () => {
    const url = new URL(window.location.href); url.searchParams.set('scenario', btoa(JSON.stringify(assignments))); window.history.replaceState(null, '', url); setShareLink(url.toString());
    try { await navigator.clipboard.writeText(url.toString()); } catch { /* The visible link remains available for manual copying. */ }
  };
  const removeFinish = (round: number, sessionType: 'RACE' | 'SPRINT', index: number) => {
    setAssignments((items) => items.map((item) => item.round !== round ? item : sessionType === 'RACE' ? { ...item, raceFinishes: item.raceFinishes.filter((_, i) => i !== index) } : { ...item, sprintFinishes: (item.sprintFinishes ?? []).filter((_, i) => i !== index) }).filter((item) => item.raceFinishes.length || item.sprintFinishes?.length)); setProjection(null); setShareLink('');
  };
  return <PageHeader eyebrow={`${season} SEASON · DETERMINISTIC CALCULATOR`} title="Championship calculator" intro="See what the confirmed points mean, then explore a finishing-order scenario. Mathematical possibilities are exact under the selected rule set; this calculator does not estimate probabilities.">
    <div className="calculator-levels" role="tablist" aria-label="Calculator detail level">{([1, 2, 3] as const).map((item) => <button key={item} role="tab" aria-selected={level === item} onClick={() => setLevel(item)}><span>LEVEL 0{item}</span><strong>{['Simple', 'Detailed', 'Interactive'][item - 1]}</strong></button>)}</div>
    {error && <div className="inline-notice calculator-error" role="alert">{error}</div>}
    {!summary ? <div className="coming-panel glass-card"><span className="coming-glyph">Σ</span><EmptyValue title={error || 'Loading verified standings'} detail="The calculator needs confirmed season data and a verified scoring ruleset." /></div> : <>
      <section className="section-block glass-card calculator-overview"><div className="section-heading"><div><div className="eyebrow">CURRENT TITLE PICTURE</div><h2>After Round {summary.throughRound}</h2></div><span className="data-chip">{summary.racesRemaining} RACES · {summary.sprintRacesRemaining} SPRINTS REMAINING</span></div>
        {summary.pastUnconfirmedRounds > 0 && <div className="calculator-data-note" role="status">{summary.pastUnconfirmedRounds} past scheduled round{summary.pastUnconfirmedRounds === 1 ? '' : 's'} beyond Round {summary.throughRound} lack confirmed results. They are excluded from remaining-points and scenario calculations.</div>}
        {level === 1 && <p className="calculator-intro">The leader has {summary.contenders[0]?.points ?? 0} points. A driver needs to make up their points gap across the remaining {summary.racesRemaining} Grands Prix{summary.sprintRacesRemaining ? ` and ${summary.sprintRacesRemaining} Sprints` : ''}. This is a points calculation, not a prediction.</p>}
        {level >= 2 && <div className="calculator-stat-row"><div><span>MAX POINTS STILL AVAILABLE PER DRIVER</span><strong>{summary.maximumPointsAvailable}</strong></div><div><span>ROUNDS CONFIRMED THROUGH</span><strong>R{summary.throughRound}</strong></div><a href={summary.scoring.sourceUrl} target="_blank" rel="noreferrer" className="text-link">Scoring rules · {summary.scoring.version} ↗</a></div>}
        <div className="table-scroll"><table className="calculator-table"><thead><tr><th>POS</th><th>DRIVER</th><th>POINTS</th><th>GAP TO LEADER</th>{level >= 2 && <><th>MAX FINAL POINTS</th><th>TITLE STATUS</th></>}</tr></thead><tbody>{summary.contenders.map((driver) => <tr key={driver.id}><td className="position">{String(driver.position).padStart(2, '0')}</td><td><strong>{driver.name}</strong></td><td className="points-cell">{driver.points}</td><td>{driver.pointsToLeader === 0 ? 'Leader' : `−${driver.pointsToLeader}`}</td>{level >= 2 && <><td>{driver.maximumFinalPoints}</td><td><span className={`title-status ${driver.mathematicallyEliminated ? 'eliminated' : 'alive'}`}>{driver.titleStatus === 'ALIVE' ? 'Mathematically alive' : 'Mathematically eliminated'}</span></td></>}</tr>)}</tbody></table></div>
      </section>
      <section className="prediction-panel glass-card" aria-labelledby="prediction-heading"><div className="section-heading"><div><div className="eyebrow">DRIVER CHAMPIONSHIP · {prediction?.modelVersion ?? 'V1'}</div><h2 id="prediction-heading">Drivers’ title estimate</h2></div><span className="data-chip">ESTIMATE · NOT A GUARANTEE</span></div>
        <p className="prediction-method">{prediction?.method ?? '60% season points pace plus 40% average points scored per round over the latest three confirmed rounds.'} This is a separate estimate and does not change the exact mathematical calculator above.</p>
        {predictionLoading ? <EmptyValue title="Checking prediction history" detail="The estimate is shown only after its method passes a rolling back-test against completed seasons." /> : !prediction ? <EmptyValue title="Prediction data is unavailable" detail="The prediction service could not be reached. Confirmed standings and mathematical scenarios remain separate." /> : !prediction.available ? <EmptyValue title={prediction.reason ?? 'Not enough data for a reliable estimate'} detail={`Back-test: ${prediction.validation?.cases ?? 0} rolling checkpoints; the model must match or beat the points-only baseline before estimates are shown.`} /> : !prediction.validation ? <EmptyValue title="Prediction validation is unavailable" detail="The estimate is hidden because its back-test metrics were not returned." /> : <><div className="prediction-validation" role="status">Back-tested across {prediction.validation.cases} checkpoints · title-leader match {prediction.validation.blendChampionAccuracy === null ? '—' : `${(prediction.validation.blendChampionAccuracy * 100).toFixed(0)}%`} · mean points error {prediction.validation.blendMeanAbsoluteError?.toFixed(1) ?? '—'}</div><div className="table-scroll"><table className="calculator-table"><thead><tr><th>EST.</th><th>DRIVER</th><th>CONFIRMED</th><th>ESTIMATED FINAL POINTS</th><th>GAP</th></tr></thead><tbody>{prediction.estimates.map((driver) => <tr key={driver.id}><td className="position">{String(driver.estimatedPosition).padStart(2, '0')}</td><td><strong>{driver.name}</strong></td><td>{driver.currentPoints}</td><td className="points-cell">{driver.projectedFinalPoints.toFixed(1)}</td><td>{driver.gapToEstimateLeader ? `−${driver.gapToEstimateLeader}` : 'Leader estimate'}</td></tr>)}</tbody></table></div><p className="analysis-method">Uses confirmed points through Round {prediction.throughRound}; horizon ends at scheduled Round {prediction.finalRound}. The title-leader match and points error describe past back-tests, not future certainty.</p></>}
      </section>
      {level === 3 && <section className="section-block scenario-builder"><div className="section-heading"><div><div className="eyebrow">NO SCENARIO IS SAVED</div><h2>Build a finishing order</h2></div><span className="data-chip">{assignments.reduce((count, item) => count + item.raceFinishes.length + (item.sprintFinishes?.length ?? 0), 0)} ASSIGNMENTS</span></div>
        <div className="scenario-controls glass-card"><label>Round<select value={roundNumber ?? ''} onChange={(event) => { setRoundNumber(Number(event.target.value)); setError(''); }}>{summary.remainingRounds.map((round) => <option key={round.round} value={round.round}>R{round.round} · {round.name}{round.isSprint ? ' · Sprint' : ''}</option>)}</select></label><label>Session<select value={session} onChange={(event) => setSession(event.target.value as 'RACE' | 'SPRINT')}><option value="RACE">Grand Prix</option>{selectedRound?.isSprint && <option value="SPRINT">Sprint</option>}</select></label><label>Driver<select value={driverId} onChange={(event) => setDriverId(event.target.value)}>{summary.contenders.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></label><label>Finishing position<select value={position} onChange={(event) => setPosition(Number(event.target.value))}>{Array.from({ length: summary.entrantCount }, (_, index) => <option key={index + 1} value={index + 1}>P{index + 1}</option>)}</select></label><button className="button-primary" onClick={addFinish} disabled={!selectedRound}>Add result <span>+</span></button></div>
        <div className="scenario-list glass-card">{assignments.length ? assignments.map((assignment) => <div className="scenario-round" key={assignment.round}><h3>Round {assignment.round} · {summary.remainingRounds.find((round) => round.round === assignment.round)?.name}</h3>{(['RACE', 'SPRINT'] as const).map((type) => { const finishes = type === 'RACE' ? assignment.raceFinishes : assignment.sprintFinishes ?? []; return finishes.length ? <div className="scenario-session" key={type}><strong>{type === 'RACE' ? 'Grand Prix' : 'Sprint'}</strong>{finishes.map((finish, index) => <span key={`${finish.driverId}-${index}`}>{summary.contenders.find((driver) => driver.id === finish.driverId)?.name ?? 'Unknown'} · P{finish.position}<button aria-label={`Remove ${type} result for ${finish.driverId}`} onClick={() => removeFinish(assignment.round, type, index)}>×</button></span>)}</div> : null; })}</div>) : <EmptyValue title="No results assigned yet" detail="Add one or more driver finishes. Unassigned drivers and sessions receive zero scenario points." />}</div>
        <div className="scenario-actions"><button className="button-primary" disabled={!assignments.length} onClick={() => void calculate()}>Calculate scenario <span>→</span></button><button className="button-secondary" onClick={reset}>Reset</button><button className="button-secondary" disabled={!assignments.length} onClick={() => void share()}>Share scenario link ↗</button></div>{shareLink && <label className="share-link-field">Shareable scenario link<input readOnly value={shareLink} onFocus={(event) => event.currentTarget.select()} /></label>}
        {projection && <section className="projection-panel glass-card" aria-labelledby="projection-heading"><div className="section-heading"><div><div className="eyebrow">SCENARIO PROJECTION · NOT A PREDICTION</div><h2 id="projection-heading">Projected standings</h2></div></div><div className="table-scroll"><table className="calculator-table"><thead><tr><th>POS</th><th>DRIVER</th><th>CONFIRMED</th><th>SCENARIO</th><th>PROJECTED</th><th>GAP</th></tr></thead><tbody>{projection.standings.map((driver) => <tr key={driver.id}><td className="position">{String(driver.projectedPosition).padStart(2, '0')}</td><td><strong>{driver.name}</strong></td><td>{driver.points}</td><td>+{driver.scenarioPoints}</td><td className="points-cell">{driver.projectedPoints}</td><td>{driver.gapToProjectedLeader ? `−${driver.gapToProjectedLeader}` : 'Leader'}</td></tr>)}</tbody></table></div><ul className="assumption-list">{projection.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></section>}
      </section>}
    </>}
  </PageHeader>;
}

function LearnPage({ season }: { season: number }) {
  const [sections, setSections] = useState<LearningSection[]>([]);
  const [terms, setTerms] = useState<LearningTerm[]>([]);
  const [questions, setQuestions] = useState<LearningQuestion[]>([]);
  const [feedback, setFeedback] = useState<Record<string, QuizFeedback>>({});
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [openTerm, setOpenTerm] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getApi<{ season: number; sections: LearningSection[] }>(`/learn/guide?season=${season}`, controller.signal),
      getApi<LearningTerm[]>('/learn/glossary', controller.signal),
      getApi<LearningQuestion[]>('/learn/quizzes', controller.signal),
    ]).then(([guide, glossary, quiz]) => {
      setSections(guide.data.sections); setTerms(glossary.data); setQuestions(quiz.data); setFailed(false);
    }).catch(() => setFailed(true));
    return () => controller.abort();
  }, [season]);
  const answer = async (question: LearningQuestion) => {
    const answerIndex = selected[question.id];
    if (answerIndex === undefined || feedback[question.id]) return;
    try {
      const result = await postApi<QuizFeedback>(`/learn/quizzes/${question.id}/answers`, { answerIndex });
      setFeedback((current) => ({ ...current, [question.id]: result.data }));
    } catch { setFailed(true); }
  };
  const score = Object.values(feedback).filter((result) => result.correct).length;
  return <PageHeader eyebrow={`${season} SEASON · THE SPORT EXPLAINED`} title="F1, made clearer." intro="A friendly starting point for race weekends, championships and the terms you’ll hear in the paddock. Your quiz answers stay in this page and are not saved.">
    {failed && <div className="inline-notice" role="status">Learning content could not load just now. Please try again.</div>}
    <div className="learn-layout">
      <section className="learn-guide" aria-label="Beginner guide">
        <div className="section-heading"><div><div className="eyebrow">START HERE</div><h2>The basics</h2></div><span className="data-chip">{season} SEASON CONTEXT</span></div>
        {sections.map((section, index) => <article className="learn-card glass-card" key={section.id}><span className="learn-index">0{index + 1}</span><div><h3>{section.title}</h3><p><InlineTerms text={section.body} terms={terms} openTerm={openTerm} onToggle={setOpenTerm} /></p>{section.sourceUrl && <a className="text-link" href={section.sourceUrl} target="_blank" rel="noreferrer">Check current FIA regulations <span>↗</span></a>}</div></article>)}
      </section>
      <section className="glass-card glossary-panel" aria-labelledby="glossary-heading"><div className="eyebrow">QUICK DEFINITIONS</div><h2 id="glossary-heading">Paddock glossary</h2><p className="learn-muted">Tap a term to open a short definition.</p><div className="term-list">{terms.map((term) => <div className="term-item" key={term.id}><button className="term-button" aria-expanded={openTerm === term.id} onClick={() => setOpenTerm(openTerm === term.id ? null : term.id)}>{term.label}<span>{openTerm === term.id ? '−' : '+'}</span></button>{openTerm === term.id && <p className="term-definition" role="status">{term.definition}</p>}</div>)}</div></section>
    </div>
    <section className="section-block quiz-section" aria-labelledby="quiz-heading"><div className="section-heading"><div><div className="eyebrow">CHECK YOUR UNDERSTANDING</div><h2 id="quiz-heading">Quick quiz</h2></div>{Object.keys(feedback).length > 0 && <span className="data-chip" aria-live="polite">SCORE · {score}/{Object.keys(feedback).length}</span>}</div><div className="quiz-grid">{questions.map((question, index) => { const result = feedback[question.id]; return <article className="quiz-card glass-card" key={question.id}><div className="eyebrow">QUESTION 0{index + 1} · {question.topic.toUpperCase()}</div><h3>{question.question}</h3><div className="quiz-options">{question.options.map((option, optionIndex) => <button key={option} disabled={Boolean(result)} aria-pressed={selected[question.id] === optionIndex} className={`quiz-option${selected[question.id] === optionIndex ? ' is-selected' : ''}${result && result.correctIndex === optionIndex ? ' is-correct' : ''}${result && selected[question.id] === optionIndex && !result.correct ? ' is-incorrect' : ''}`} onClick={() => setSelected((current) => ({ ...current, [question.id]: optionIndex }))}><span>{String.fromCharCode(65 + optionIndex)}</span>{option}</button>)}</div>{!result ? <button className="button-primary quiz-submit" disabled={selected[question.id] === undefined} onClick={() => void answer(question)}>Check answer <span>→</span></button> : <div className={`quiz-feedback ${result.correct ? 'correct' : 'incorrect'}`} role="status"><strong>{result.correct ? 'That’s right.' : `Not quite. The answer is ${String.fromCharCode(65 + result.correctIndex)}.`}</strong><p>{result.explanation}</p></div>}</article>; })}</div>{Object.keys(feedback).length === questions.length && questions.length > 0 && <div className="explainer glass-surface" role="status"><span className="explainer-mark">✓</span><p><strong>Quiz complete · {score} of {questions.length} correct.</strong> Your result exists only in this page and will clear when you leave or reload.</p></div>}</section>
  </PageHeader>;
}

function InlineTerms({ text, terms, openTerm, onToggle }: { text: string; terms: LearningTerm[]; openTerm: string | null; onToggle: (id: string | null) => void }) {
  const termsInText = terms.filter((term) => text.toLowerCase().includes(term.label.toLowerCase())).sort((a, b) => b.label.length - a.label.length);
  if (!termsInText.length) return text;
  const pattern = new RegExp(`\\b(${termsInText.map((term) => term.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
  return <>{text.split(pattern).map((part, index) => {
    const term = termsInText.find((item) => item.label.toLowerCase() === part.toLowerCase());
    if (!term) return part;
    const isOpen = openTerm === `inline-${term.id}`;
    return <span className="inline-term-wrap" key={`${term.id}-${index}`}><button type="button" className="inline-term" aria-expanded={isOpen} aria-label={`Explain ${term.label}`} onClick={() => onToggle(isOpen ? null : `inline-${term.id}`)}>{part}</button>{isOpen && <span className="inline-term-popover" role="status">{term.definition}</span>}</span>;
  })}</>;
}

function AboutPage() {
  return <PageHeader eyebrow="ABOUT · DATA · METHOD" title="Independent by design." intro="Paddock is an independent fan project. It is not official Formula 1 and is not affiliated with Formula 1, the FIA, or any team.">
    <div className="about-grid">
      <section className="about-panel glass-card"><div className="eyebrow">DATA SOURCE</div><h2>Community data, clearly credited.</h2><p>Race schedules, classifications and historical records are supplied by Jolpica-F1, a volunteer-maintained community data project and successor to the Ergast API.</p><a className="text-link" href="https://github.com/jolpica/jolpica-f1" target="_blank" rel="noreferrer">Jolpica-F1 source and attribution <span>↗</span></a><p className="about-note">Jolpica-F1 data is licensed CC BY-NC-SA 4.0 for non-commercial use. Service availability and post-race update timing are not guaranteed.</p></section>
      <section className="about-panel glass-card"><div className="eyebrow">CALCULATIONS</div><h2>Season-aware scoring.</h2><p>Standings are recalculated from stored race and sprint classifications with the selected season's scoring rules. For 2026, scoring follows FIA General Regulatory Provisions, Section A, Article A2.2, Issue 02.</p><a className="text-link" href="https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_a_general_provisions_-_iss_02_-_2026-02-27.pdf" target="_blank" rel="noreferrer">FIA 2026 regulations <span>↗</span></a><p className="about-note">If the provider's points do not match our verified rule set, the import is rejected and the site marks its data stale.</p></section>
      <section className="about-panel glass-card"><div className="eyebrow">PREDICTION METHOD</div><h2>Driver title estimates need evidence.</h2><p>The v1 Drivers’ Championship estimate blends 60% confirmed season points pace with 40% average points scored per round over the latest three confirmed rounds. Its rolling back-test compares title-leader matches and final-points error with a points-only baseline.</p><p className="about-note">The estimate is not a guarantee or a probability. It is hidden when there are fewer than 12 back-test checkpoints or when it does not match or beat the baseline. Scenario calculations remain exact and separate.</p></section>
      <section className="about-panel glass-card"><div className="eyebrow">UPDATES & IMAGES</div><h2>No live race coverage.</h2><p>Data refreshes manually after a Grand Prix. The site does not show live timing or in-race updates. It displays the last round confirmed in local data and makes incomplete or stale data visible.</p><p className="about-note">No third-party driver photos or team logos are used. Original typography and a custom visual identity keep this project distinct from official F1 branding.</p></section>
    </div>
  </PageHeader>;
}

function PageHeader({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: ReactNode }) {
  return <><div className="page-heading"><div className="eyebrow eyebrow-line"><span /> {eyebrow}</div><h1>{title}</h1><p>{intro}</p></div>{children}</>;
}

function EmptyValue({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-value"><span className="empty-mark" aria-hidden="true">—</span><strong>{title}</strong><p>{detail}</p></div>;
}

export default App;
