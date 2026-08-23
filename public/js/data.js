/* ============================================================================
   data.js — Référentiels statiques
   RÈGLE 13 : rien ici n'est présenté comme une donnée de marché vivante.
   Ce fichier ne contient que des caractéristiques structurelles d'ETF
   (indice, frais, réplication, éligibilité PEA...) marquées comme
   "référence à vérifier" avec une date. Les prix, performances et
   fondamentaux viennent EXCLUSIVEMENT des fournisseurs (market.js).
   ========================================================================== */
(function (G) {
  'use strict';

  /* ---------------------------------------------------------------- Profils */
  const PROFILES = {
    prudent: {
      key: 'prudent', label: 'Prudent',
      target: { etf: 60, actions: 10, crypto: 5, immobilier: 25 },
      maxSinglePosition: 12,       // % max d'une ligne
      maxSectorExposure: 25,
      maxStockSleeve: 10,          // % max en actions en direct
      maxCryptoSleeve: 8,          // % max en cryptoactifs
      volTolerance: 10,            // volatilité annualisée tolérée (%)
      maxDrawdownTolerance: 20,
      hypotheses: { pess: 0.5, central: 3.0, opti: 5.0, vol: 7 },
      weights: { fees: .19, diversification: .17, aum: .10, track: .07, riskAdj: .16, fit: .14, role: .17 }
    },
    equilibre: {
      key: 'equilibre', label: 'Équilibré',
      target: { etf: 55, actions: 15, crypto: 10, immobilier: 20 },
      maxSinglePosition: 15,
      maxSectorExposure: 35,
      maxStockSleeve: 20,
      maxCryptoSleeve: 15,
      volTolerance: 15,
      maxDrawdownTolerance: 35,
      hypotheses: { pess: 2.0, central: 5.5, opti: 8.5, vol: 12 },
      weights: { fees: .18, diversification: .16, aum: .10, track: .07, riskAdj: .18, fit: .16, role: .15 }
    },
    dynamique: {
      key: 'dynamique', label: 'Dynamique',
      target: { etf: 45, actions: 25, crypto: 20, immobilier: 10 },
      maxSinglePosition: 20,
      maxSectorExposure: 45,
      maxStockSleeve: 35,
      maxCryptoSleeve: 30,
      volTolerance: 22,
      maxDrawdownTolerance: 50,
      hypotheses: { pess: 1.0, central: 7.0, opti: 11.0, vol: 17 },
      weights: { fees: .15, diversification: .14, aum: .09, track: .07, riskAdj: .22, fit: .21, role: .12 }
    }
  };

  /* -------------------------------------------------- Catalogue ETF (réf.) */
  /* asOf = date de dernière saisie manuelle de la fiche. verified:false =>
     l'application baisse explicitement le niveau de confiance et affiche un
     lien pour contrôler le DIC/KID de l'émetteur avant toute décision.       */
  const REF_DATE = '2026-01';
  const E = (o) => Object.assign({
    type: 'etf', verified: false, asOf: REF_DATE, source: 'Fiche de référence saisie manuellement',
    currency: 'EUR', replication: 'Physique', dist: 'Capitalisant', pea: false, incepted: null,
    holdings: null, ter: null, aum: null, geo: {}, sector: {}
  }, o);

  /* Répartitions géo/sectorielles = ordres de grandeur de l'indice, approximatifs. */
  const GEO_WORLD = { 'États-Unis': 71, 'Japon': 6, 'Royaume-Uni': 4, 'Europe hors RU': 12, 'Asie-Pacifique': 5, 'Autres': 2 };
  const GEO_ACWI = { 'États-Unis': 64, 'Japon': 5, 'Royaume-Uni': 3, 'Europe hors RU': 11, 'Émergents': 11, 'Asie-Pacifique': 4, 'Autres': 2 };
  const GEO_US = { 'États-Unis': 100 };
  const GEO_EU = { 'Royaume-Uni': 23, 'France': 17, 'Suisse': 15, 'Allemagne': 13, 'Pays-Bas': 7, 'Europe du Nord': 12, 'Europe du Sud': 13 };
  const GEO_EM = { 'Chine': 27, 'Inde': 19, 'Taïwan': 18, 'Corée du Sud': 11, 'Brésil': 5, 'Autres émergents': 20 };
  const SEC_WORLD = { 'Technologie': 26, 'Finance': 16, 'Santé': 11, 'Conso. discrétionnaire': 11, 'Industrie': 11, 'Conso. de base': 6, 'Énergie': 4, 'Communication': 8, 'Services publics': 3, 'Matériaux': 3, 'Immobilier': 2 };
  const SEC_EU = { 'Finance': 21, 'Industrie': 17, 'Santé': 14, 'Conso. discrétionnaire': 10, 'Conso. de base': 9, 'Technologie': 8, 'Matériaux': 6, 'Énergie': 5, 'Services publics': 5, 'Communication': 4, 'Immobilier': 1 };
  const SEC_EM = { 'Technologie': 26, 'Finance': 22, 'Conso. discrétionnaire': 13, 'Communication': 9, 'Industrie': 7, 'Matériaux': 7, 'Énergie': 5, 'Conso. de base': 5, 'Santé': 3, 'Services publics': 3, 'Immobilier': 1 };

  const ETF_CATALOG = [
    E({ id:'IWDA', ticker:'IWDA', isin:'IE00B4L5Y983', name:'iShares Core MSCI World UCITS ETF (Acc)',
        index:'MSCI World', ter:0.20, aum:80000, holdings:1350, incepted:2009, currency:'USD',
        pea:false, geo:GEO_WORLD, sector:SEC_WORLD, assetClass:'Actions monde développé',
        note:'Brique de fond de portefeuille la plus standard sur CTO/AV.' }),
    E({ id:'SPPW', ticker:'SPPW', isin:'IE00BFY0GT14', name:'SPDR MSCI World UCITS ETF (Acc)',
        index:'MSCI World', ter:0.12, aum:9000, holdings:1350, incepted:2019, currency:'USD',
        pea:false, geo:GEO_WORLD, sector:SEC_WORLD, assetClass:'Actions monde développé',
        note:'Même indice qu\'IWDA, frais plus bas, historique plus court.' }),
    E({ id:'VWCE', ticker:'VWCE', isin:'IE00BK5BQT80', name:'Vanguard FTSE All-World UCITS ETF (Acc)',
        index:'FTSE All-World', ter:0.22, aum:28000, holdings:3600, incepted:2019, currency:'USD',
        pea:false, geo:GEO_ACWI, sector:SEC_WORLD, assetClass:'Actions monde + émergents',
        note:'Inclut les marchés émergents : un seul ETF pour couvrir le monde entier.' }),
    E({ id:'CW8', ticker:'CW8', isin:'LU1681043599', name:'Amundi MSCI World UCITS ETF (Acc)',
        index:'MSCI World', ter:0.38, aum:6000, holdings:1350, incepted:2009, currency:'EUR',
        pea:true, replication:'Synthétique (swap)', geo:GEO_WORLD, sector:SEC_WORLD,
        assetClass:'Actions monde développé',
        note:'Principale façon d\'obtenir le MSCI World à l\'intérieur d\'un PEA. Frais plus élevés et risque de contrepartie lié au swap.' }),
    E({ id:'ESE', ticker:'ESE', isin:'FR0011550185', name:'BNP Paribas Easy S&P 500 UCITS ETF (Acc)',
        index:'S&P 500', ter:0.12, aum:4000, holdings:500, incepted:2013, currency:'EUR',
        pea:true, replication:'Synthétique (swap)', geo:GEO_US, sector:SEC_WORLD,
        assetClass:'Actions États-Unis', note:'Exposition S&P 500 éligible PEA, frais contenus.' }),
    E({ id:'CSPX', ticker:'CSPX', isin:'IE00B5BMR087', name:'iShares Core S&P 500 UCITS ETF (Acc)',
        index:'S&P 500', ter:0.07, aum:100000, holdings:500, incepted:2010, currency:'USD',
        pea:false, geo:GEO_US, sector:SEC_WORLD, assetClass:'Actions États-Unis',
        note:'Très liquide et très peu cher, mais 100 % États-Unis : à ne pas confondre avec un fonds monde.' }),
    E({ id:'MEUD', ticker:'MEUD', isin:'LU0908500753', name:'Amundi Core STOXX Europe 600 UCITS ETF (Acc)',
        index:'STOXX Europe 600', ter:0.07, aum:5000, holdings:600, incepted:2013, currency:'EUR',
        pea:true, geo:GEO_EU, sector:SEC_EU, assetClass:'Actions Europe',
        note:'Frais très bas, réplication physique, éligible PEA : brique européenne efficace.' }),
    E({ id:'SMEA', ticker:'SMEA', isin:'IE00B4K48X80', name:'iShares Core MSCI Europe UCITS ETF (Acc)',
        index:'MSCI Europe', ter:0.12, aum:6000, holdings:430, incepted:2010, currency:'EUR',
        pea:false, geo:GEO_EU, sector:SEC_EU, assetClass:'Actions Europe' }),
    E({ id:'EIMI', ticker:'EIMI', isin:'IE00BKM4GZ66', name:'iShares Core MSCI EM IMI UCITS ETF (Acc)',
        index:'MSCI Emerging Markets IMI', ter:0.18, aum:20000, holdings:3000, incepted:2014, currency:'USD',
        pea:false, geo:GEO_EM, sector:SEC_EM, assetClass:'Actions émergents',
        note:'Très large (petites capitalisations incluses). Volatilité et risque politique plus élevés.' }),
    E({ id:'AEEM', ticker:'AEEM', isin:'LU1681045370', name:'Amundi MSCI Emerging Markets UCITS ETF (Acc)',
        index:'MSCI Emerging Markets', ter:0.20, aum:3000, holdings:1400, incepted:2011, currency:'EUR',
        pea:true, replication:'Synthétique (swap)', geo:GEO_EM, sector:SEC_EM,
        assetClass:'Actions émergents', note:'Exposition émergents éligible PEA.' }),
    E({ id:'AGGH', ticker:'AGGH', isin:'IE00BDBRDM35', name:'iShares Core Global Aggregate Bond UCITS ETF EUR-H (Acc)',
        index:'Bloomberg Global Aggregate', ter:0.10, aum:6000, holdings:8000, incepted:2017, currency:'EUR',
        pea:false, geo:{'États-Unis':40,'Europe':30,'Japon':12,'Autres':18},
        sector:{'Obligations souveraines':55,'Obligations d\'entreprise':30,'Titrisé':15},
        assetClass:'Obligations monde couvert EUR',
        note:'Amortisseur de portefeuille : baisse la volatilité globale, rendement attendu plus faible.' }),
    E({ id:'IPRP', ticker:'IPRP', isin:'IE00B0M63284', name:'iShares European Property Yield UCITS ETF (Dist)',
        index:'FTSE EPRA Nareit Developed Europe', ter:0.40, aum:1500, holdings:60, incepted:2006,
        currency:'EUR', dist:'Distribuant', pea:false,
        geo:{'Allemagne':22,'Royaume-Uni':21,'France':13,'Suède':13,'Suisse':10,'Autres Europe':21},
        sector:{'Immobilier':100}, assetClass:'Immobilier coté (SIIC/REIT)',
        note:'Alternative liquide à l\'immobilier participatif. Sensible aux taux, seulement ~60 lignes.' }),
    E({ id:'PANX', ticker:'PANX', isin:'LU1681038243', name:'Amundi Nasdaq-100 UCITS ETF (Acc)',
        index:'Nasdaq-100', ter:0.22, aum:4000, holdings:100, incepted:2017, currency:'EUR',
        pea:false, geo:GEO_US,
        sector:{'Technologie':50,'Communication':16,'Conso. discrétionnaire':13,'Santé':6,'Conso. de base':6,'Industrie':5,'Autres':4},
        assetClass:'Actions technologie É.-U.',
        note:'Très concentré (100 lignes, moitié technologie). À doser : recoupe largement un ETF monde.' }),
    E({ id:'CAC', ticker:'CAC', isin:'FR0007052782', name:'Amundi CAC 40 UCITS ETF (Acc)',
        index:'CAC 40', ter:0.25, aum:2500, holdings:40, incepted:2001, currency:'EUR', pea:true,
        geo:{'France':100}, sector:SEC_EU, assetClass:'Actions France',
        note:'40 lignes, un seul pays : diversification faible, à considérer comme une brique satellite.' })
  ];

  /* Rôle structurel dans un portefeuille de long terme.
     `core` (0-10) : aptitude du fonds à constituer le CŒUR du portefeuille.
     `max`  (%)    : part au-delà de laquelle il cesse d'être raisonnable.
     Sans ce garde-fou, un fonds de niche passerait devant un fonds monde au
     seul motif qu'il ne recoupe pas les positions existantes — un ETF
     émergents diversifie beaucoup, mais ne remplace pas un socle mondial. */
  const ROLE = {
    IWDA:{ core:10, max:100 }, SPPW:{ core:10, max:100 }, VWCE:{ core:10, max:100 }, CW8:{ core:9, max:100 },
    CSPX:{ core:6,  max:50  }, ESE: { core:6,  max:50  }, MEUD:{ core:6,  max:40  }, SMEA:{ core:6, max:40 },
    AGGH:{ core:6,  max:40  }, EIMI:{ core:4,  max:15  }, AEEM:{ core:4,  max:15  }, IPRP:{ core:3, max:10 },
    PANX:{ core:2,  max:10  }, CAC: { core:2,  max:10  }
  };
  ETF_CATALOG.forEach(e => {
    const r = ROLE[e.id] || { core: 5, max: 25 };
    e.core = r.core; e.maxWeight = r.max;
  });

  /* -------------------------------------- Univers de scan actions (tickers) */
  /* Aucune donnée fondamentale n'est stockée ici : uniquement des identifiants
     que le moteur ira interroger auprès des fournisseurs. Si le fournisseur ne
     répond pas, l'action est écartée avec la mention "données insuffisantes". */
  const STOCK_UNIVERSE = [
    { t:'AAPL', n:'Apple',             sector:'Technologie',            region:'États-Unis' },
    { t:'MSFT', n:'Microsoft',         sector:'Technologie',            region:'États-Unis' },
    { t:'NVDA', n:'NVIDIA',            sector:'Technologie',            region:'États-Unis' },
    { t:'GOOGL',n:'Alphabet',          sector:'Communication',          region:'États-Unis' },
    { t:'AMZN', n:'Amazon',            sector:'Conso. discrétionnaire', region:'États-Unis' },
    { t:'META', n:'Meta Platforms',    sector:'Communication',          region:'États-Unis' },
    { t:'BRK.B',n:'Berkshire Hathaway',sector:'Finance',                region:'États-Unis' },
    { t:'V',    n:'Visa',              sector:'Finance',                region:'États-Unis' },
    { t:'MA',   n:'Mastercard',        sector:'Finance',                region:'États-Unis' },
    { t:'JNJ',  n:'Johnson & Johnson', sector:'Santé',                  region:'États-Unis' },
    { t:'UNH',  n:'UnitedHealth',      sector:'Santé',                  region:'États-Unis' },
    { t:'PG',   n:'Procter & Gamble',  sector:'Conso. de base',         region:'États-Unis' },
    { t:'KO',   n:'Coca-Cola',         sector:'Conso. de base',         region:'États-Unis' },
    { t:'COST', n:'Costco',            sector:'Conso. de base',         region:'États-Unis' },
    { t:'HD',   n:'Home Depot',        sector:'Conso. discrétionnaire', region:'États-Unis' },
    { t:'ASML', n:'ASML',              sector:'Technologie',            region:'Europe' },
    { t:'SAP',  n:'SAP',               sector:'Technologie',            region:'Europe' },
    { t:'MC.PA',n:'LVMH',              sector:'Conso. discrétionnaire', region:'France' },
    { t:'OR.PA',n:'L\'Oréal',          sector:'Conso. de base',         region:'France' },
    { t:'AI.PA',n:'Air Liquide',       sector:'Matériaux',              region:'France' },
    { t:'SU.PA',n:'Schneider Electric',sector:'Industrie',              region:'France' },
    { t:'SAN.PA',n:'Sanofi',           sector:'Santé',                  region:'France' },
    { t:'TTE.PA',n:'TotalEnergies',    sector:'Énergie',                region:'France' },
    { t:'BNP.PA',n:'BNP Paribas',      sector:'Finance',                region:'France' },
    { t:'DG.PA', n:'Vinci',            sector:'Industrie',              region:'France' },
    { t:'RMS.PA',n:'Hermès',           sector:'Conso. discrétionnaire', region:'France' }
  ];

  /* ------------------------------------------------------------ Conclusions */
  const CONCLUSIONS = {
    INTERESTING: { key:'INTERESTING', label:'Intéressante',                 cls:'c-good' },
    WATCH:       { key:'WATCH',       label:'À surveiller',                 cls:'c-watch' },
    EXPENSIVE:   { key:'EXPENSIVE',   label:'Valorisation élevée',          cls:'c-watch' },
    RISKY:       { key:'RISKY',       label:'Risque important',             cls:'c-bad' },
    UNFIT:       { key:'UNFIT',       label:'Pas adaptée à mon portefeuille',cls:'c-bad' },
    NODATA:      { key:'NODATA',      label:'Données insuffisantes pour conclure', cls:'c-info' }
  };

  /* Palette du thème sombre : teintes désaturées mais suffisamment lumineuses
     pour ressortir sur fond noir, et distinctes deux à deux. */
  const ASSET_COLORS = {
    etf:'#4d8dd6', actions:'#9b86d9', crypto:'#e0913a', immobilier:'#c9973f', cash:'#4bab9f', obligations:'#4bb87f'
  };

  const PALETTE = ['#4d8dd6','#9b86d9','#c9973f','#4bab9f','#4bb87f','#e2635e',
                   '#7ba7cf','#b08a6a','#8f7fc4','#5fc0b3','#d9b96a','#8d97a8'];

  /* ------------------------------------------------------ Cryptoactifs
     Table de correspondance ticker → identifiant CoinGecko. CoinGecko est
     gratuit et sans clé : les cours crypto fonctionnent donc sans rien
     configurer, comme les taux de change de la BCE.
     `cap` = ordre de grandeur de capitalisation, utilisé seulement pour
     distinguer les grandes capitalisations des jetons spéculatifs. */
  const CRYPTO_CATALOG = [
    { t:'BTC',  id:'bitcoin',      n:'Bitcoin',        cap:'large' },
    { t:'ETH',  id:'ethereum',     n:'Ethereum',       cap:'large' },
    { t:'USDT', id:'tether',       n:'Tether',         cap:'stable' },
    { t:'USDC', id:'usd-coin',     n:'USD Coin',       cap:'stable' },
    { t:'BNB',  id:'binancecoin',  n:'BNB',            cap:'large' },
    { t:'SOL',  id:'solana',       n:'Solana',         cap:'large' },
    { t:'XRP',  id:'ripple',       n:'XRP',            cap:'large' },
    { t:'ADA',  id:'cardano',      n:'Cardano',        cap:'mid' },
    { t:'DOGE', id:'dogecoin',     n:'Dogecoin',       cap:'mid' },
    { t:'TRX',  id:'tron',         n:'TRON',           cap:'mid' },
    { t:'AVAX', id:'avalanche-2',  n:'Avalanche',      cap:'mid' },
    { t:'DOT',  id:'polkadot',     n:'Polkadot',       cap:'mid' },
    { t:'LINK', id:'chainlink',    n:'Chainlink',      cap:'mid' },
    { t:'MATIC',id:'matic-network',n:'Polygon',        cap:'mid' },
    { t:'POL',  id:'polygon-ecosystem-token', n:'Polygon (POL)', cap:'mid' },
    { t:'LTC',  id:'litecoin',     n:'Litecoin',       cap:'mid' },
    { t:'TON',  id:'the-open-network', n:'Toncoin',    cap:'mid' },
    { t:'SHIB', id:'shiba-inu',    n:'Shiba Inu',      cap:'small' },
    { t:'ATOM', id:'cosmos',       n:'Cosmos',         cap:'mid' },
    { t:'UNI',  id:'uniswap',      n:'Uniswap',        cap:'mid' },
    { t:'XLM',  id:'stellar',      n:'Stellar',        cap:'mid' },
    { t:'NEAR', id:'near',         n:'NEAR Protocol',  cap:'mid' },
    { t:'APT',  id:'aptos',        n:'Aptos',          cap:'mid' },
    { t:'SUI',  id:'sui',          n:'Sui',            cap:'mid' },
    { t:'ARB',  id:'arbitrum',     n:'Arbitrum',       cap:'small' },
    { t:'OP',   id:'optimism',     n:'Optimism',       cap:'small' },
    { t:'FIL',  id:'filecoin',     n:'Filecoin',       cap:'small' },
    { t:'ETC',  id:'ethereum-classic', n:'Ethereum Classic', cap:'mid' },
    { t:'ALGO', id:'algorand',     n:'Algorand',       cap:'small' },
    { t:'VET',  id:'vechain',      n:'VeChain',        cap:'small' },
    { t:'ICP',  id:'internet-computer', n:'Internet Computer', cap:'small' },
    { t:'HBAR', id:'hedera-hashgraph', n:'Hedera',     cap:'mid' },
    { t:'INJ',  id:'injective-protocol', n:'Injective', cap:'small' },
    { t:'IMX',  id:'immutable-x',  n:'Immutable',      cap:'small' },
    { t:'GRT',  id:'the-graph',    n:'The Graph',      cap:'small' },
    { t:'AAVE', id:'aave',         n:'Aave',           cap:'small' },
    { t:'MKR',  id:'maker',        n:'Maker',          cap:'small' },
    { t:'LDO',  id:'lido-dao',     n:'Lido DAO',       cap:'small' },
    { t:'STX',  id:'blockstack',   n:'Stacks',         cap:'small' },
    { t:'TIA',  id:'celestia',     n:'Celestia',       cap:'small' },
    { t:'SEI',  id:'sei-network',  n:'Sei',            cap:'small' },
    { t:'RNDR', id:'render-token', n:'Render',         cap:'small' },
    { t:'PEPE', id:'pepe',         n:'Pepe',           cap:'small' },
    { t:'CRV',  id:'curve-dao-token', n:'Curve DAO',   cap:'small' },
    { t:'SAND', id:'the-sandbox',  n:'The Sandbox',    cap:'small' },
    { t:'MANA', id:'decentraland', n:'Decentraland',   cap:'small' },
    { t:'FTM',  id:'fantom',       n:'Fantom',         cap:'small' },
    { t:'XTZ',  id:'tezos',        n:'Tezos',          cap:'small' },
    { t:'EGLD', id:'elrond-erd-2', n:'MultiversX',     cap:'small' },
    { t:'KAS',  id:'kaspa',        n:'Kaspa',          cap:'small' },
    { t:'CRO',  id:'crypto-com-chain',  n:'Cronos',   cap:'small' },
    { t:'TRUMP',id:'official-trump',    n:'OFFICIAL TRUMP', cap:'small' }
  ];
  const CRYPTO_BY_TICKER = {};
  CRYPTO_CATALOG.forEach(c => CRYPTO_BY_TICKER[c.t] = c);

  G.DATA = { PROFILES, ETF_CATALOG, STOCK_UNIVERSE, CONCLUSIONS, ASSET_COLORS, PALETTE, REF_DATE,
             CRYPTO_CATALOG, CRYPTO_BY_TICKER };
})(window);
