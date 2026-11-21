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
is was were been has had does did re ll ve d m s t isn aren wasn weren hasn haven hadn doesn didn don won wouldn
couldn shouldn mustn ain o e g i ie etc via vs ok okay oh
myself yourself itself ourselves themselves himself herself ours yours mine theirs whom whose
an because although though unless whereas besides moreover furthermore therefore thus hence overall ultimate
otherwise meanwhile perhaps maybe indeed certainly especially particularly mostly nearly almost later ever
outside beside beneath behind among amid despite except per plus regardless versus whatever whenever wherever
built wrote written led ran made took taken got gotten gave given knew known met began begun grew grown drove found
sold paid taught held saw seen thought bought caught fed felt heard lost meant rode said shown spoke stood told
understood went wore brought kept spent sent became came left
ability accuracy accurate achieve achievement adapt adaptable ad hoc advance advice age ancestry applicable
accommodate accommodation analytical apprentice approachable assistant attract audience award aware
belong bike brand budget campus capacity care challenge chain charity choice citizen citizenship classroom
clarity club coffee color colour commerce communication competition concise confidence confident connect
conscientious consideration consistent cooperate coordinate creativity curiosity curious customer deadline
dedicate dedication demand demographic dependable detail diligence disability discipline discussion
economic economics effort empathy energy engage enthusiasm enthusiastic equal ethic ethnicity excite expertise
explanation facility fair federal feedback finding forecast friendly gender genetic grade guidance habit hardworking
honest honesty identity improvement inclusion innovation innovative integrity interpersonal intersection interview
journey law leader leadership learner listening logistic marital medical merchandise merchandising messy method
military mindset mission motivation national neat neighborhood nonprofit numerical observe opportunity organized
origin outdoor pace passion patience patron pay persistence perspective pivot practical precise precision
pregnancy presentation pride priority proactive productive protect protected proud pursue punctual race reliable
recognize regard religion reputation resilient resourceful retail retailer revenue rigor sale sales satisfaction
sex sexual share shipment shop spreadsheet stakeholder statistic statistics store storytelling supply sustainability
tackle teamwork thorough thoughtful timely tutor tutoring veteran volunteer volunteering workplace workload
app kpi metrics proven imagine picture trend trends visualization visualize insightful accessible career careful cleaning clear clinic
`;

export const COMMON_WORDS = Object.freeze(new Set(WORDS.split(/\s+/).filter(Boolean)));
