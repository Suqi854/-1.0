// Minute observation coverage is not completeness of an exchange auction feed.
export function auctionQuality(points,now=Date.now()){
 const today=new Date(now+8*3600000).toISOString().slice(0,10),session=points[0]?.source_timestamp.slice(0,10)??null;
 const phases=[['early_observations','09:15','09:19'],['late_observations','09:20','09:24'],['post_auction_reports','09:25','09:30']].map(([name,start,end])=>({name,start,end,points:points.filter(p=>{const t=p.source_timestamp.slice(11,16);return t>=start&&t<=end;}).length}));
 const observed=new Set(points.map(p=>p.source_timestamp.slice(11,16))),missing=[];
 // Only diagnose missing labels on a known returned date and after that minute.
 if(session)for(let minute=15;minute<=30;minute++){const label='09:'+minute;if(Date.parse(session+'T'+label+':00+08:00')+60000<=now&&!observed.has(label))missing.push(label);}
 return {session_date:session,requested_local_date:today,same_day:session===null?null:session===today,observed_minutes:points.length,missing_elapsed_minute_labels:missing,phases,positive_reported_volume_points:points.filter(p=>p.reported_volume_shares>0).length,missing_reported_volume_points:points.filter(p=>p.reported_volume_shares===null).length,missing_reported_amount_points:points.filter(p=>p.reported_amount_cny===null).length,scope:'09:15–09:30 provider minute labels only; zero missing labels does not establish a complete auction feed or final match result',unavailable_fields:['virtual_matched_shares','unmatched_buy_shares','unmatched_sell_shares','final_match_price','final_match_volume_shares','cancelled_orders']};
}
