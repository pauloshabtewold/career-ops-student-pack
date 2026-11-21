// Common English words (base forms) for the fact gate: a posting word on this list is not a risk word unless it is also
// on the known-tech list. General high-frequency words plus the generic vocabulary of job postings and cover letters;
// no tool, product, company or skill-specific term belongs here. Inflections (-s, -es, -ed, -ing, -er, -est, -ly) are
// matched by lib/fact-gate.mjs, so only base forms are listed.
const WORDS = `
a able about above across act action active actual add address after again against age ago agree ahead aim all allow
almost alone along already also always am among amount an and annual another answer any anyone anything apart appear
apply approach appropriate are area around arrive art as ask assist at attend attention available average avoid away
back bad balance base basic be bear beat become before begin behind being believe below benefit best better between
beyond big bit board body both bring broad build business busy but buy by call can capable care career carry case
cause center central certain chance change charge check choose city class clean clear client close coach colleague
college come comfortable common communicate community company complete complex concern condition consider contact
contain continue contribute control cost could count country couple course cover create creative culture current
customer cut daily data date day deal dear decide decision deep degree deliver department describe design desire
detail determine develop development different difficult direct direction director discover do document does done
door down draft drive due during duty each eager early ease easy education effect effective effort either else email
employee employer enable end engage engineering enjoy enough ensure enter entire entry environment equal especially
even event ever every everyone everything exact example excellent excited exciting exist expect experience explain
express extra eye face fact fair fall family far fast feel few field figure file fill final find fine finish firm fit
focus follow for form former forward free friend from front full fun function future gain general get give glad go
goal good great group grow growth guide hand handle happen happy hard have he head health hear help her here high him
his hold home hope host hour house how however human idea identify if impact important improve in include increase
independent individual industry information initiative inside insight instead interest interested internal intern
internship into involve issue it item its job join just keen keep key kind know knowledge large last late lead learn
least leave left less let level life like likely line list listen little live local long look lot love low main
maintain major make manage manager many market matter may me mean meet member mind minimum mission model modern
money more most move much multiple must my name nation natural near necessary need network never new next nice no
none nor normal not note nothing now number objective of off offer office often on once only open operation
opportunity or order organization other our out outcome over own owner page paid part partner pass past pay people
per perform period person pick place plan please plus point policy position positive possible post power practice
prefer prepare present pretty previous primary prior problem process produce product professional program progress
project proper provide public purpose put quality question quick quite raise range rather reach read ready real
reason receive recent record reduce regard related relationship rely remain remote report request require research
resource respect respond responsibility responsible rest result return review right role room run safe same save say
schedule school science season second see seek seem self send senior sense serve service set several shape share she
should show side simple since single site size skill small so social solid solution solve some someone something
sometimes soon sort speak special specific spend staff stage stand standard start state status stay step still stop
story strategy strong structure student study style subject success successful such suggest summer support sure
system take talent talk task team tell term test than thank that the their them then there these they thing think
this those though through throughout time title to today together tool top topic toward track training travel true
trust try turn type under understand unit university until up update upon us use useful user usual value variety
various very view visit want way we week weekly welcome well what when where whether which while who whole why will
win with within without word work worker world would write year yes yet you young your
across actually additional analyst analytics applicant application assignment associate background benefit bonus
candidate capability collaborate collaboration commitment competitive core coursework cross daily degree diverse
diversity eligible employment equity excellence exposure flexible friendly fulltime graduate hands hire hiring hybrid
inclusive insurance junior level location mentor mentorship onsite operations orientation parttime paid portfolio
preferred qualification qualified rewarding salary semester stipend team technical teammate weekly week wellness
analysis analyze attach career clinic customer dashboard detail diligent effective efficient focus great hand insight
metric motivate organize patient present process professional proficient quality reporting result skilled solid
strength strong support verbal written
`;

export const COMMON_WORDS = Object.freeze(new Set(WORDS.split(/\s+/).filter(Boolean)));
