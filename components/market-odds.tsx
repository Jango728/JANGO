import type {Fight,Fighter} from '@/lib/types';
export function MarketOdds({fight,a,b}:{fight:Fight;a:Fighter;b:Fighter}){
 const odds=fight.odds,format=(n:number)=>n>0?'+'+n:String(n);
 return <section className="market-odds surface"><div className="market-odds-head"><strong>Market odds</strong><span className="tag">Display only · excluded from model</span></div>{odds?<><div className="odds-prices">{[a,b].map((f,i)=><div key={f.id}><span>{f.name}</span><strong>{format(i?odds.b:odds.a)}</strong><small>American odds</small></div>)}</div><p className="fine">Prices can change. These are not live quotes.</p><a className="out" href={odds.source} target="_blank" rel="noopener noreferrer">View price source ↗</a></>:<p className="odds-pending">Lines have not been posted or verified yet. The prediction still runs independently of the market.</p>}<p className="fine">Winner, method and rounds predictions never read these prices or other people’s picks.</p></section>;
}
