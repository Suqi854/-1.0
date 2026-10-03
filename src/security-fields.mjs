// Tencent's own SuperData SOCKET_MAP names positions 47/48 LimitUp/LimitDown.
// These are provider snapshot fields, not exchange-certified effective rules.
export function tencentLimits(fields,quote){
 if(quote.symbol?.startsWith('bj'))return null;
 const parse=v=>typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
 const up=parse(fields[47]),down=parse(fields[48]);
 if(up===null||down===null||up<=down||quote.price>up||quote.price<down||quote.high>up||(quote.low>0&&quote.low<down))return null;
 const cents=v=>Math.round(v*100);if([up,down,quote.price].some(v=>Math.abs(v*100-cents(v))>1e-6))return null;
 return {source:'tencent',source_timestamp:quote.source_timestamp,limit_up_price:up,limit_down_price:down,price_relation:cents(quote.price)===cents(up)?'at_upper_limit':cents(quote.price)===cents(down)?'at_lower_limit':'between_limits',mapping_verified:true,exchange_verified:false,field_mapping:{limit_up:47,limit_down:48},meaning:'Last reported price relative to limits in this same provider snapshot; not current trading eligibility, a locked order book, or verified suspension status'};
}
