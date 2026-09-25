/**
 * UFC champions + media-panel rankings, from UFC.com/rankings (media ranking, last updated Sep 22, 2026),
 * champion bios from each UFC.com athlete page. Prospects are Jango Playz's own threat list, built from
 * UFC.com records (checked Sep 25, 2026). Refreshed by the nightly job.
 */
export const RANKINGS_AS_OF = "Sep 22, 2026";
export type Move = "up" | "down" | "new" | null;
export type Contender = { name: string; move?: Move; by?: number };
export type Prospect = { name: string; record: string; age: number; rank?: number; tag: string; why: string; threat: 1 | 2 | 3 };
export type Division = {
  id: string;
  name: string;
  short: string;
  women?: boolean;
  limit: number;
  champion: { name: string; nickname?: string; record: string; age: number; height: string; reach: number; from: string; style?: string; img: string; interim?: boolean; p4p?: number; note: string };
  top10: Contender[];
  prospects: Prospect[];
};

const c = (name: string, move: Move = null, by?: number): Contender => ({ name, move, by });

export const DIVISIONS: Division[] = [
  {
    id: "fly", name: "Flyweight", short: "FLY", limit: 125,
    champion: { name: "Joshua Van", nickname: "The Fearless", record: "18-2-0", age: 24, height: "5'5\"", reach: 65, from: "Hakha, Myanmar", style: "Freestyle", img: "champions/joshua-van.webp", p4p: 6, note: "9 KO wins · 3 first-round finishes" },
    top10: [c("Alexandre Pantoja"), c("Manel Kape"), c("Brandon Royval"), c("Tatsuro Taira"), c("Kyoji Horiguchi"), c("Lone'er Kavanagh"), c("Asu Almabayev"), c("Brandon Moreno"), c("Amir Albazi"), c("Ramazan Temirov")],
    prospects: [
      { name: "Bilal Hasan", record: "10-0", age: 25, tag: "Contender Series KO", why: "Unbeaten. Won his UFC contract with a 45-second knockout on DWCS 2026 week 1.", threat: 3 },
      { name: "Christian Natividad", record: "10-0", age: 29, tag: "Contender Series KO", why: "Perfect record. First-round knockout on DWCS week 5 earned the contract.", threat: 2 },
      { name: "Imanol Rodriguez", record: "7-0", age: 26, tag: "Unbeaten newcomer", why: "Undefeated since his Feb 2026 debut. Faces Alden Coria at UFC 332.", threat: 2 },
      { name: "Rei Tsuruya", record: "12-1", age: 24, rank: 13, tag: "Grappling phenom", why: "24 years old with one career loss and already on the edge of the rankings.", threat: 2 },
    ],
  },
  {
    id: "bw", name: "Bantamweight", short: "BW", limit: 135,
    champion: { name: "Petr Yan", nickname: "No Mercy", record: "20-5-0", age: 33, height: "5'7.5\"", reach: 67, from: "Krasnoyarsk Krai, Russia", style: "Boxer", img: "champions/petr-yan.webp", p4p: 4, note: "7 KO wins · 3 first-round finishes" },
    top10: [c("Merab Dvalishvili"), c("Sean O'Malley"), c("Song Yadong"), c("Umar Nurmagomedov"), c("Mario Bautista"), c("Cory Sandhagen"), c("Aiemann Zahabi"), c("David Martinez"), c("Deiveson Figueiredo"), c("Marlon Vera")],
    prospects: [
      { name: "Raul Rosas Jr.", record: "12-1", age: 21, rank: 12, tag: "21 years old", why: "12-1 (6-1 UFC) at 21 and already ranked. Headlines vs Raoni Barcelos on Sep 26. Nobody in the division has a longer runway.", threat: 3 },
    ],
  },
  {
    id: "fw", name: "Featherweight", short: "FW", limit: 145,
    champion: { name: "Alexander Volkanovski", nickname: "The Great", record: "28-4-0", age: 37, height: "5'6\"", reach: 71.5, from: "Wollongong, Australia", img: "champions/alexander-volkanovski.webp", p4p: 2, note: "13 KO wins · 7 first-round finishes" },
    top10: [c("Movsar Evloev"), c("Diego Lopes"), c("Lerone Murphy"), c("Aljamain Sterling"), c("Jean Silva"), c("Yair Rodriguez"), c("Arnold Allen"), c("Youssef Zalal"), c("Kevin Vallejos"), c("Steve Garcia")],
    prospects: [
      { name: "Tommy McMillen", record: "12-0", age: 28, tag: "Perfect record", why: "Unbeaten since his April 2026 debut. Handed 11-0 Marwan Rahiki his first loss at Noche UFC. 74\" reach.", threat: 3 },
      { name: "Marwan Rahiki", record: "9-1", age: 24, tag: "Young finisher", why: "24 years old. His only loss came in a close decision against another unbeaten prospect.", threat: 1 },
    ],
  },
  {
    id: "lw", name: "Lightweight", short: "LW", limit: 155,
    champion: { name: "Justin Gaethje", nickname: "The Highlight", record: "28-5-0", age: 37, height: "5'11\"", reach: 70, from: "Tucson, USA", style: "MMA", img: "champions/justin-gaethje.webp", p4p: 3, note: "21 KO wins · 9 first-round finishes" },
    top10: [c("Ilia Topuria"), c("Arman Tsarukyan"), c("Charles Oliveira"), c("Max Holloway"), c("Paddy Pimblett"), c("Benoît Saint Denis"), c("Quillan Salkilld", "up", 1), c("Mauricio Ruffy", "down", 1), c("Salahdine Parnasse"), c("Mateusz Gamrot", "up", 1)],
    prospects: [
      { name: "Akbar Abdullaev", record: "14-0", age: 28, tag: "Contender Series KO", why: "14-0. Knocked his man out in 19 seconds on DWCS 2026 week 6 to earn the contract.", threat: 3 },
      { name: "Piero Guaylupo", record: "12-0", age: 21, tag: "Unbeaten at 21", why: "12-0 at 21 years old. Signed off DWCS 2026 week 7.", threat: 3 },
      { name: "Silvestre Sanchez", record: "10-1", age: 24, tag: "Contender Series KO", why: "24 years old. Stopped his opponent in round 3 on DWCS week 4, with a 73\" reach at 155 lbs.", threat: 2 },
    ],
  },
  {
    id: "ww", name: "Welterweight", short: "WW", limit: 170,
    champion: { name: "Islam Makhachev", record: "29-1-0", age: 34, height: "5'10\"", reach: 70.5, from: "Dagestan, Russia", style: "Sambo", img: "champions/islam-makhachev.webp", p4p: 1, note: "17-fight win streak · 13 submission wins" },
    top10: [c("Ian Machado Garry"), c("Carlos Prates"), c("Michael Morales"), c("Jack Della Maddalena"), c("Gabriel Bonfim"), c("Sean Brady"), c("Belal Muhammad"), c("Leon Edwards"), c("Kamaru Usman"), c("Joaquin Buckley")],
    prospects: [
      { name: "Alvi Dasuyev", record: "10-0", age: 24, tag: "Unbeaten", why: "10-0 at 24. Earned his contract on DWCS 2026 week 7.", threat: 3 },
      { name: "Sean Clancy Jr.", record: "9-0", age: 23, tag: "Contender Series KO", why: "9-0 at 23, with a round-2 knockout on DWCS week 3.", threat: 2 },
      { name: "Isaac Moreno", record: "9-0", age: 28, tag: "Unbeaten", why: "Perfect record. Won a clear decision on DWCS week 5 to get signed.", threat: 1 },
    ],
  },
  {
    id: "mw", name: "Middleweight", short: "MW", limit: 185,
    champion: { name: "Sean Strickland", record: "31-7-0", age: 35, height: "6'1\"", reach: 76, from: "USA", style: "MMA", img: "champions/sean-strickland.webp", p4p: 7, note: "12 KO wins · 9 first-round finishes" },
    top10: [c("Khamzat Chimaev"), c("Dricus Du Plessis"), c("Nassourdine Imavov"), c("Brendan Allen"), c("Caio Borralho"), c("Joe Pyfer"), c("Gregory Rodrigues"), c("Anthony Hernandez"), c("Israel Adesanya"), c("Christian Leroy Duncan")],
    prospects: [
      { name: "Ateba Gautier", record: "11-1", age: 24, tag: "81\" reach", why: "24 years old with a huge frame and a knockout finisher's record. Faces Kopylov at UFC 332.", threat: 3 },
      { name: "Modestino Rodrigues", record: "8-1", age: 22, tag: "15-second KO", why: "22 years old, 6'3\". Won his contract with a 15-second knockout on DWCS week 4.", threat: 3 },
      { name: "Martin Kozák", record: "7-0", age: 24, tag: "Contender Series KO", why: "Unbeaten. Round-2 knockout on DWCS week 5.", threat: 2 },
      { name: "Damian Pinas", record: "10-1", age: 24, tag: "Knockout threat", why: "24 years old with a 79.5\" reach. Debuted in Feb 2026.", threat: 1 },
    ],
  },
  {
    id: "lhw", name: "Light Heavyweight", short: "LHW", limit: 205,
    champion: { name: "Carlos Ulberg", nickname: "Black Jag", record: "15-1-0", age: 35, height: "6'4\"", reach: 77, from: "Auckland, New Zealand", style: "Kickboxer", img: "champions/carlos-ulberg.webp", p4p: 15, note: "10 KO wins · 8 first-round finishes" },
    top10: [c("Magomed Ankalaev"), c("Jiří Procházka"), c("Alex Pereira"), c("Khalil Rountree Jr."), c("Navajo Stirling"), c("Paulo Costa"), c("Jamahal Hill"), c("Azamat Murzakanov"), c("Jan Błachowicz"), c("Dominick Reyes")],
    prospects: [
      { name: "Quentin Pasley", record: "4-0", age: 24, tag: "Contender Series KO", why: "6'4\" with a 78\" reach, unbeaten. First-round knockout on DWCS week 5. Early days, but the tools stand out.", threat: 2 },
    ],
  },
  {
    id: "hw", name: "Heavyweight", short: "HW", limit: 265,
    champion: { name: "Ciryl Gane", nickname: "Bon Gamin", record: "14-2-0", age: 36, height: "6'4\"", reach: 81, from: "La Roche-sur-Yon, France", style: "Muay Thai", img: "champions/ciryl-gane.webp", interim: true, p4p: 11, note: "Interim title · 7 KO wins" },
    top10: [c("Tom Aspinall", "down", 1), c("Alexander Volkov"), c("Sergei Pavlovich"), c("Josh Hokit"), c("Curtis Blaydes"), c("Waldo Cortes Acosta"), c("Rizvan Kuniev"), c("Vitor Petrino"), c("Serghei Spivac"), c("Ante Delija")],
    prospects: [
      { name: "Valter Walker", record: "16-1", age: 28, rank: 11, tag: "Young heavyweight", why: "28 is young for heavyweight, and he has one loss in 17 fights.", threat: 3 },
      { name: "Anthony Wint", record: "8-0", age: 30, tag: "34-second KO", why: "Unbeaten. Won his contract with a 34-second knockout on DWCS week 1, with a 78\" reach.", threat: 2 },
      { name: "Brando Peričić", record: "7-1", age: 32, tag: "City Kickboxing", why: "6'5\" wrestler with a 79.5\" reach. Debuted in Sep 2025.", threat: 1 },
    ],
  },
  {
    id: "wsw", name: "Women's Strawweight", short: "W115", women: true, limit: 115,
    champion: { name: "Mackenzie Dern", record: "17-5-0", age: 33, height: "5'4\"", reach: 63, from: "USA", style: "Brazilian Jiu-Jitsu", img: "champions/mackenzie-dern.webp", p4p: 5, note: "8 submission wins · 6 first-round finishes" },
    top10: [c("Zhang Weili"), c("Tatiana Suarez"), c("Virna Jandiroba"), c("Denise Gomes"), c("Gillian Robertson"), c("Yan Xiaonan"), c("Fatima Kline"), c("Loopy Godinez"), c("Alexia Thainara"), c("Jéssica Andrade")],
    prospects: [
      { name: "Jaqueline Amorim", record: "11-2", age: 31, tag: "Submission hunter", why: "BJJ specialist with a 68\" reach, long for strawweight.", threat: 2 },
    ],
  },
  {
    id: "wfw", name: "Women's Flyweight", short: "W125", women: true, limit: 125,
    champion: { name: "Valentina Shevchenko", nickname: "Bullet", record: "26-4-1", age: 38, height: "5'5\"", reach: 67, from: "Bishkek, Kyrgyzstan", style: "Muay Thai", img: "champions/valentina-shevchenko.webp", p4p: 1, note: "8 KO · 7 submission wins" },
    top10: [c("Natalia Silva"), c("Alexa Grasso"), c("Manon Fiorot"), c("Erin Blanchfield"), c("Rose Namajunas"), c("Maycee Barber"), c("Jasmine Jasudavicius"), c("Wang Cong"), c("Tracy Cortez"), c("Miranda Maverick")],
    prospects: [
      { name: "Regina Tarin", record: "9-0", age: 21, rank: 15, tag: "Unbeaten at 21", why: "Undefeated, ranked in her first year, and just beat JJ Aldrich at Noche UFC.", threat: 3 },
      { name: "Carli Judice", record: "7-2", age: 27, tag: "Striker", why: "5'7\" with a 68\" reach, trending up in the division.", threat: 1 },
    ],
  },
  {
    id: "wbw", name: "Women's Bantamweight", short: "W135", women: true, limit: 135,
    champion: { name: "Kayla Harrison", record: "19-1-0", age: 36, height: "5'8\"", reach: 66, from: "Middletown, USA", style: "Judo", img: "champions/kayla-harrison.webp", p4p: 2, note: "Two-time Olympic judo gold · 9 first-round finishes" },
    top10: [c("Julianna Peña"), c("Raquel Pennington"), c("Joselyne Edwards"), c("Norma Dumont"), c("Ailin Perez"), c("Yana Santos"), c("Luana Santos"), c("Macy Chiasson"), c("Jacqueline Cavalcanti"), c("Karol Rosa")],
    prospects: [
      { name: "Bia Mesquita", record: "8-0", age: 35, rank: 11, tag: "BJJ legend", why: "Unbeaten and one of the most decorated grapplers in the sport.", threat: 3 },
      { name: "Daria Zhelezniakova", record: "10-3", age: 30, tag: "Tall striker", why: "5'9\" with length and pressure on the feet.", threat: 1 },
    ],
  },
];

export const P4P = {
  men: [c("Islam Makhachev"), c("Alexander Volkanovski"), c("Justin Gaethje", "up", 1), c("Petr Yan", "down", 1), c("Ilia Topuria"), c("Joshua Van", "up", 5), c("Sean Strickland"), c("Tom Aspinall", "down", 2), c("Merab Dvalishvili", "down", 1), c("Alex Pereira", "down", 1)],
  women: [c("Valentina Shevchenko"), c("Kayla Harrison"), c("Zhang Weili"), c("Natalia Silva"), c("Mackenzie Dern"), c("Alexa Grasso"), c("Manon Fiorot"), c("Erin Blanchfield"), c("Tatiana Suarez"), c("Julianna Peña")],
};
