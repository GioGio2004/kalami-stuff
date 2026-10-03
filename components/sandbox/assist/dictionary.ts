/**
 * Short explanations for the "explain this" hover, in Georgian and English.
 * One or two sentences each: what it is and when to use it. Drafted by Claude;
 * the lecturer should read the Georgian once and fix anything that sounds off.
 */

export type Locale = "ka" | "en";
export type Text = { ka: string; en: string };

export const TAGS: Record<string, Text> = {
  html: { ka: "გვერდის ფესვი: ყველაფერი მის შიგნით იწერება.", en: "The root of the page: everything else goes inside it." },
  head: {
    ka: "ინფორმაცია გვერდზე, რომელიც არ ჩანს: სათაური, CSS-ის ბმული, meta ტეგები.",
    en: "Information about the page that isn't shown: the title, links to CSS, meta tags.",
  },
  body: { ka: "ყველაფერი, რაც გვერდზე ჩანს, აქ იწერება.", en: "Everything visible on the page goes here." },
  title: { ka: "გვერდის სახელი, რომელიც ბრაუზერის ჩანართზე ჩანს.", en: "The page's name, shown on the browser tab." },
  meta: {
    ka: "დამატებითი ინფორმაცია ბრაუზერისთვის, მაგალითად სიმბოლოების კოდირება (charset).",
    en: "Extra information for the browser, like the text encoding (charset).",
  },
  link: {
    ka: "გვერდს სხვა ფაილს აკავშირებს. rel=\"stylesheet\"-ით შენს CSS-ს ტვირთავს.",
    en: "Connects another file to the page. With rel=\"stylesheet\" it loads your CSS.",
  },
  style: {
    ka: "HTML ფაილში ჩაწერილი CSS. ჩვეულებრივ, უმჯობესია style.css-ში დაწერო.",
    en: "CSS written inside the HTML file. Usually it's better in style.css.",
  },
  div: {
    ka: "ყუთი საკუთარი მნიშვნელობის გარეშე: ელემენტების დასაჯგუფებლად და გასაფორმებლად.",
    en: "A box with no meaning of its own, used to group things and style them.",
  },
  span: {
    ka: "პატარა შესაფუთი ტექსტის ნაწილისთვის, რომ ცალკე გააფორმო.",
    en: "A small wrapper for part of a text, so you can style it on its own.",
  },
  p: { ka: "ტექსტის აბზაცი.", en: "A paragraph of text." },
  h1: { ka: "მთავარი სათაური. გვერდს ჩვეულებრივ ერთი აქვს.", en: "The main heading. A page usually has one." },
  h2: { ka: "განყოფილების სათაური, h1-ზე პატარა.", en: "A section heading, smaller than h1." },
  h3: { ka: "ქვეგანყოფილების სათაური.", en: "A sub-section heading." },
  h4: { ka: "კიდევ უფრო პატარა სათაური.", en: "An even smaller heading." },
  h5: { ka: "პატარა სათაური.", en: "A small heading." },
  h6: { ka: "ყველაზე პატარა სათაური.", en: "The smallest heading." },
  a: { ka: "ბმული. href მიუთითებს, სად მიდის.", en: "A link. href says where it goes." },
  img: {
    ka: "სურათი. src — ფაილი, alt — აღწერა მათთვის, ვინც ვერ ხედავს. დამხურავი ტეგი არ აქვს.",
    en: "An image. src is the file, alt describes it for people who can't see it. It has no closing tag.",
  },
  ul: { ka: "დაუნომრავი სია (მარკერებით). ყოველი პუნქტი <li>-ია.", en: "A bulleted list. Each item is an <li>." },
  ol: { ka: "დანომრილი სია. ყოველი პუნქტი <li>-ია.", en: "A numbered list. Each item is an <li>." },
  li: { ka: "სიის ერთი პუნქტი. იწერება <ul>-ში ან <ol>-ში.", en: "One item of a list. It goes inside <ul> or <ol>." },
  nav: { ka: "სანავიგაციო ბმულების ჯგუფი, მაგალითად მენიუ.", en: "A group of navigation links, like a menu." },
  header: {
    ka: "გვერდის ან განყოფილების ზედა ნაწილი: ლოგო, სათაური, მენიუ.",
    en: "The top part of a page or section: logo, title, menu.",
  },
  footer: {
    ka: "გვერდის ან განყოფილების ქვედა ნაწილი: კონტაქტები, საავტორო უფლებები.",
    en: "The bottom part of a page or section: contacts, copyright.",
  },
  main: { ka: "გვერდის მთავარი შინაარსი. ერთხელ გამოიყენება.", en: "The main content of the page. Use it once." },
  section: {
    ka: "გვერდის ნაწილი საკუთარი თემით, ჩვეულებრივ სათაურით.",
    en: "A part of the page with its own topic, usually with a heading.",
  },
  article: {
    ka: "დამოუკიდებელი შინაარსი, მაგალითად პოსტი ან ბარათი.",
    en: "A piece that makes sense on its own, like a post or a card.",
  },
  aside: { ka: "დამატებითი შინაარსი, მაგალითად გვერდითი ზოლი.", en: "Side content, like a sidebar or a note." },
  strong: { ka: "მნიშვნელოვანი ტექსტი, მუქად ნაჩვენები.", en: "Important text, shown in bold." },
  b: { ka: "მუქი ტექსტი.", en: "Bold text." },
  em: { ka: "ხაზგასმული ტექსტი, დახრილად ნაჩვენები.", en: "Emphasised text, shown in italics." },
  i: { ka: "დახრილი ტექსტი.", en: "Italic text." },
  small: { ka: "პატარა, მეორეხარისხოვანი ტექსტი.", en: "Small print, less important text." },
  br: { ka: "ახალ ხაზზე გადასვლა. დამხურავი ტეგი არ აქვს.", en: "A line break. It has no closing tag." },
  hr: { ka: "ჰორიზონტალური ხაზი თემებს შორის.", en: "A horizontal line between topics." },
  button: { ka: "ღილაკი, რომელზეც შეიძლება დაჭერა.", en: "A button people can click." },
  form: { ka: "ფორმა, რომელიც ველებს აერთიანებს.", en: "A form that groups input fields." },
  input: {
    ka: "ველი, სადაც მომხმარებელი წერს. type ირჩევს სახეს: text, email, checkbox… დამხურავი ტეგი არ აქვს.",
    en: "A field people type into. type picks the kind: text, email, checkbox… It has no closing tag.",
  },
  label: {
    ka: "ველის წარწერა. for უნდა ემთხვეოდეს ველის id-ს.",
    en: "The caption of a field. Its for should match the field's id.",
  },
  textarea: { ka: "მრავალხაზიანი ტექსტის ველი.", en: "A text field with several lines." },
  select: { ka: "ჩამოსაშლელი სია; ვარიანტები <option>-ებია.", en: "A drop-down list; its choices are <option>s." },
  option: { ka: "ერთი ვარიანტი <select>-ში.", en: "One choice inside a <select>." },
  table: { ka: "ცხრილი სტრიქონებით (<tr>) და უჯრებით (<td>).", en: "A table of rows (<tr>) and cells (<td>)." },
  thead: { ka: "ცხრილის სათაურების ნაწილი.", en: "The heading part of a table." },
  tbody: { ka: "ცხრილის ძირითადი ნაწილი.", en: "The main part of a table." },
  tr: { ka: "ცხრილის ერთი სტრიქონი.", en: "One row of a table." },
  td: { ka: "ცხრილის ერთი უჯრა.", en: "One cell of a table." },
  th: { ka: "ცხრილის სათაურის უჯრა, მუქად ნაჩვენები.", en: "A heading cell of a table, shown in bold." },
  figure: { ka: "სურათი ან დიაგრამა თავისი წარწერით.", en: "An image or diagram with its caption." },
  figcaption: { ka: "<figure>-ის წარწერა.", en: "The caption of a <figure>." },
  blockquote: { ka: "სხვისი ციტატა, ცალკე ბლოკად.", en: "A quotation from someone else, as its own block." },
  code: { ka: "კოდის ნაწილი ტექსტში, თანაბარი სიგანის შრიფტით.", en: "A piece of code inside text, in a monospace font." },
  pre: { ka: "ტექსტი ზუსტად ისე, როგორც დაწერე, ჰარეებით და ხაზებით.", en: "Text exactly as written, keeping spaces and line breaks." },
  video: { ka: "ვიდეო; controls ღილაკებს აჩვენებს.", en: "A video; controls shows the play buttons." },
  audio: { ka: "აუდიო; controls ღილაკებს აჩვენებს.", en: "Audio; controls shows the play buttons." },
  iframe: { ka: "სხვა გვერდი შენი გვერდის შიგნით.", en: "Another page shown inside yours." },
  script: {
    ka: "JavaScript-ის კოდი. ამ კურსში ჯერ არ გამოიყენება და აქ არ გაეშვება.",
    en: "JavaScript code. It isn't part of this course yet and won't run here.",
  },
};

export const ATTRIBUTES: Record<string, Text> = {
  class: {
    ka: "სახელი გასაფორმებლად. რამდენიმე ელემენტს შეიძლება ერთი ჰქონდეს; CSS-ში წერტილით იწერება: .card",
    en: "A name for styling. Several elements can share it; in CSS you write it with a dot: .card",
  },
  id: {
    ka: "ერთი ელემენტის უნიკალური სახელი. CSS-ში #-ით იწერება: #top",
    en: "A unique name for one element. In CSS you write it with #: #top",
  },
  href: { ka: "სად მიდის ბმული, ან რომელ ფაილს ტვირთავს <link>.", en: "Where a link goes, or which file a <link> loads." },
  src: { ka: "საჩვენებელი ფაილი: <img>, <video> და სხვ.", en: "The file to show, for <img>, <video> and others." },
  alt: {
    ka: "სურათის აღწერა: ეკრანის წამკითხველი მას ხმამაღლა კითხულობს და ის ჩანს, თუ სურათი ვერ ჩაიტვირთა.",
    en: "Describes an image: screen readers read it aloud, and it shows if the image can't load.",
  },
  rel: {
    ka: "როგორ უკავშირდება მიბმული ფაილი გვერდს; stylesheet ნიშნავს CSS-ს.",
    en: "How a linked file relates to the page; stylesheet means CSS.",
  },
  style: {
    ka: "ერთ ელემენტზე დაწერილი CSS. დავალებებში CSS style.css-ში იწერება.",
    en: "CSS written on one element. In tasks, CSS goes in style.css.",
  },
  lang: { ka: "გვერდის ენა, მაგ. ka ან en.", en: "The page's language, e.g. ka or en." },
  charset: {
    ka: "ტექსტის კოდირება; UTF-8 ქართულ ასოებს სწორად აჩვენებს.",
    en: "The text encoding; UTF-8 shows Georgian letters correctly.",
  },
  target: { ka: "_blank ბმულს ახალ ჩანართში ხსნის.", en: "_blank opens the link in a new tab." },
  title: { ka: "მინიშნება, რომელიც მაუსის მიტანისას ჩანს.", en: "A tip shown when the mouse rests on the element." },
  width: { ka: "სიგანე პიქსელებში (CSS-ით უფრო მოქნილია).", en: "Width in pixels (CSS gives you more control)." },
  height: { ka: "სიმაღლე პიქსელებში.", en: "Height in pixels." },
  type: { ka: "ველის ან ღილაკის სახე, მაგ. text, email, submit.", en: "The kind of field or button, e.g. text, email, submit." },
  placeholder: { ka: "მკრთალი ტექსტი ცარიელ ველში.", en: "Faint hint text in an empty field." },
  name: { ka: "ველის სახელი, რომლითაც მონაცემი იგზავნება.", en: "The field's name when the form is sent." },
  value: { ka: "ველის ან ვარიანტის მნიშვნელობა.", en: "The value of a field or option." },
  for: { ka: "ველის id, რომელსაც ეს წარწერა ეკუთვნის.", en: "The id of the field this label belongs to." },
  controls: { ka: "აჩვენებს დაკვრის ღილაკებს.", en: "Shows the play buttons." },
};

const side = (prop: string, ka: string, en: string): Record<string, Text> =>
  Object.fromEntries(
    (["top", "right", "bottom", "left"] as const).map((s) => {
      const kaSide = { top: "ზემოთ", right: "მარჯვნივ", bottom: "ქვემოთ", left: "მარცხნივ" }[s];
      return [`${prop}-${s}`, { ka: `${ka} მხოლოდ ${kaSide}.`, en: `${en} on the ${s} side only.` }];
    }),
  );

export const PROPERTIES: Record<string, Text> = {
  color: { ka: "ტექსტის ფერი.", en: "The text colour." },
  "background-color": { ka: "ელემენტის ფონის ფერი.", en: "The element's background colour." },
  background: {
    ka: "ფონის შემოკლებული ჩანაწერი: ფერი, სურათი და სხვ.",
    en: "Shorthand for the background: colour, image and more.",
  },
  "background-image": { ka: "ფონის სურათი, url(...)-ით.", en: "A background image, with url(...)." },
  "background-size": { ka: "ფონის სურათის ზომა: cover ავსებს მთელ ყუთს.", en: "Size of the background image: cover fills the box." },
  "font-size": { ka: "ტექსტის ზომა, მაგ. 16px ან 1.5rem.", en: "The size of the text, e.g. 16px or 1.5rem." },
  "font-family": {
    ka: "შრიფტი, სათადარიგოებით: Arial, sans-serif.",
    en: "The font, with fallbacks: Arial, sans-serif.",
  },
  "font-weight": { ka: "ტექსტის სისქე: normal, bold ან 100–900.", en: "How thick the text is: normal, bold or 100–900." },
  "font-style": { ka: "დახრილობა: normal ან italic.", en: "Slant: normal or italic." },
  font: { ka: "შრიფტის შემოკლებული ჩანაწერი: ზომა და შრიფტი ერთად.", en: "Shorthand for size and font together." },
  "text-align": { ka: "ტექსტის სწორება: left, center, right.", en: "Lines text up: left, center, right." },
  "text-decoration": {
    ka: "ხაზები ტექსტზე: underline; none ბმულის ხაზს აშორებს.",
    en: "Lines on text: underline; none removes a link's underline.",
  },
  "text-transform": {
    ka: "ასოების ზომა: uppercase, lowercase, capitalize.",
    en: "Letter case: uppercase, lowercase, capitalize.",
  },
  "text-shadow": { ka: "ტექსტის ჩრდილი.", en: "A shadow behind the text." },
  "line-height": { ka: "მანძილი ტექსტის ხაზებს შორის.", en: "The space between lines of text." },
  "letter-spacing": { ka: "მანძილი ასოებს შორის.", en: "The space between letters." },
  width: { ka: "ელემენტის სიგანე.", en: "How wide the element is." },
  height: { ka: "ელემენტის სიმაღლე.", en: "How tall the element is." },
  "max-width": { ka: "ყველაზე დიდი სიგანე, რამდენამდეც ელემენტი იზრდება.", en: "The widest the element may grow." },
  "min-width": { ka: "ყველაზე პატარა სიგანე.", en: "The narrowest the element may get." },
  "max-height": { ka: "ყველაზე დიდი სიმაღლე.", en: "The tallest the element may grow." },
  "min-height": { ka: "ყველაზე პატარა სიმაღლე.", en: "The shortest the element may get." },
  margin: {
    ka: "ადგილი ელემენტის ჩარჩოს გარეთ, სხვებს აშორებს. margin: 0 auto ბლოკს ცენტრში აყენებს.",
    en: "Space outside the element's border, pushing others away. margin: 0 auto centres a block.",
  },
  ...side("margin", "გარე დაშორება", "Outside space"),
  padding: {
    ka: "ადგილი ელემენტის შიგნით, ჩარჩოსა და შიგთავსს შორის.",
    en: "Space inside the element, between its border and its content.",
  },
  ...side("padding", "შიდა დაშორება", "Inside space"),
  border: {
    ka: "ხაზი ელემენტის გარშემო: სისქე, სტილი, ფერი, მაგ. 1px solid #333.",
    en: "A line around the element: width, style, colour, e.g. 1px solid #333.",
  },
  ...side("border", "ჩარჩო", "A border"),
  "border-radius": { ka: "კუთხეებს ამრგვალებს. 50% კვადრატს წრედ აქცევს.", en: "Rounds the corners. 50% turns a square into a circle." },
  "border-color": { ka: "ჩარჩოს ფერი.", en: "The border's colour." },
  "border-width": { ka: "ჩარჩოს სისქე.", en: "The border's thickness." },
  "border-style": { ka: "ჩარჩოს სტილი: solid, dashed, dotted…", en: "The border's style: solid, dashed, dotted…" },
  outline: { ka: "ხაზი ჩარჩოს გარეთ, ადგილს არ იკავებს.", en: "A line outside the border that takes no space." },
  "box-shadow": { ka: "ჩრდილი ელემენტის გარშემო.", en: "A shadow around the element." },
  "box-sizing": {
    ka: "border-box-ით width უკვე მოიცავს padding-სა და border-ს.",
    en: "With border-box, width already includes padding and border.",
  },
  display: {
    ka: "როგორ ლაგდება ელემენტი: block, inline, flex, grid, none.",
    en: "How the element is laid out: block, inline, flex, grid, none.",
  },
  "flex-direction": { ka: "flex ელემენტების მიმართულება: row ან column.", en: "The direction flex items go: row or column." },
  "justify-content": {
    ka: "ელემენტების სწორება მთავარი მიმართულებით: center, space-between…",
    en: "Lines items up along the main direction: center, space-between…",
  },
  "align-items": {
    ka: "ელემენტების სწორება განივი მიმართულებით: center, flex-start…",
    en: "Lines items up across the main direction: center, flex-start…",
  },
  "flex-wrap": { ka: "გადავიდნენ თუ არა ელემენტები ახალ ხაზზე: wrap ან nowrap.", en: "Whether items move to a new line: wrap or nowrap." },
  flex: { ka: "როგორ იზრდება და იკუმშება flex ელემენტი; flex: 1 თავისუფალ ადგილს ავსებს.", en: "How a flex item grows and shrinks; flex: 1 fills the free space." },
  gap: { ka: "მანძილი flex ან grid ელემენტებს შორის.", en: "The space between flex or grid items." },
  "grid-template-columns": { ka: "grid-ის სვეტები, მაგ. 1fr 1fr 1fr.", en: "The grid's columns, e.g. 1fr 1fr 1fr." },
  "grid-template-rows": { ka: "grid-ის სტრიქონები.", en: "The grid's rows." },
  position: {
    ka: "როგორ თავსდება ელემენტი: static, relative, absolute, fixed, sticky.",
    en: "How the element is placed: static, relative, absolute, fixed, sticky.",
  },
  top: { ka: "დაშორება ზედა კიდიდან (position-თან ერთად).", en: "Distance from the top edge (with position)." },
  right: { ka: "დაშორება მარჯვენა კიდიდან.", en: "Distance from the right edge." },
  bottom: { ka: "დაშორება ქვედა კიდიდან.", en: "Distance from the bottom edge." },
  left: { ka: "დაშორება მარცხენა კიდიდან.", en: "Distance from the left edge." },
  "z-index": { ka: "რომელი ელემენტი დევს ზემოთ, როცა ერთმანეთს ფარავენ.", en: "Which element is on top when they overlap." },
  "list-style": { ka: "სიის მარკერები; none აშორებს მათ.", en: "A list's bullets; none removes them." },
  "list-style-type": { ka: "მარკერის სახე: disc, circle, square, decimal, none.", en: "The bullet type: disc, circle, square, decimal, none." },
  opacity: { ka: "გამჭვირვალობა: 0 — უხილავი, 1 — სრულად ხილული.", en: "See-through-ness: 0 is invisible, 1 fully visible." },
  cursor: { ka: "მაუსის ისრის სახე, მაგ. pointer.", en: "The mouse pointer's shape, e.g. pointer." },
  overflow: {
    ka: "რა ხდება, როცა შიგთავსი არ ეტევა: hidden, scroll, auto.",
    en: "What happens when the content doesn't fit: hidden, scroll, auto.",
  },
  transition: { ka: "თანდათანობითი ცვლილება, მაგ. ფერის hover-ზე.", en: "Makes changes happen smoothly, e.g. a colour on hover." },
  transform: { ka: "ელემენტის გადაადგილება, მოტრიალება ან გადიდება.", en: "Moves, rotates or scales the element." },
  "object-fit": { ka: "როგორ ავსებს სურათი თავის ყუთს: cover, contain.", en: "How an image fills its box: cover, contain." },
  "vertical-align": { ka: "ხაზოვანი ელემენტის ვერტიკალური სწორება.", en: "Vertical alignment of an inline element." },
  "white-space": { ka: "როგორ იშლება ტექსტი ხაზებად.", en: "How text breaks into lines." },
  visibility: { ka: "ელემენტის დამალვა ისე, რომ ადგილი დარჩეს.", en: "Hides the element but keeps its space." },
  float: { ka: "ელემენტს მარცხნივ ან მარჯვნივ აგდებს, ტექსტი გარს უვლის.", en: "Pushes an element left or right; text flows around it." },
};

export const VALUES: Record<string, Text> = {
  flex: { ka: "ელემენტი flex-კონტეინერი ხდება: შვილები რიგში ლაგდება.", en: "Makes a flex container: its children line up in a row." },
  grid: { ka: "ელემენტი grid-ად იქცევა: შვილები ბადეში ლაგდება.", en: "Makes a grid: its children go into rows and columns." },
  block: { ka: "მთელ სიგანეს იკავებს და ახალი ხაზიდან იწყება.", en: "Takes the full width and starts on a new line." },
  inline: { ka: "ტექსტთან ერთ ხაზზე დგას; width არ მოქმედებს.", en: "Sits in the line of text; width doesn't apply." },
  "inline-block": { ka: "ტექსტთან ერთ ხაზზე, მაგრამ ზომის მიცემა შეიძლება.", en: "Sits in the line, but can take a size." },
  none: { ka: "არაფერი: მაგ. display: none მალავს, list-style: none აშორებს მარკერებს.", en: "Nothing: display: none hides, list-style: none removes bullets." },
  center: { ka: "ცენტრში.", en: "In the centre." },
  "space-between": { ka: "პირველი და ბოლო კიდეებზე, დანარჩენი თანაბრად შუაში.", en: "First and last at the edges, the rest evenly between." },
  "space-around": { ka: "თანაბარი ადგილი ყველა ელემენტის გარშემო.", en: "Equal space around every item." },
  auto: { ka: "ბრაუზერი თვითონ ითვლის; margin: auto თავისუფალ ადგილს ავსებს.", en: "The browser works it out; margin: auto takes the free space." },
  solid: { ka: "უწყვეტი ხაზი.", en: "A solid line." },
  dashed: { ka: "წყვეტილი ხაზი.", en: "A dashed line." },
  bold: { ka: "მუქი.", en: "Bold." },
  relative: { ka: "ჩვეულ ადგილზე რჩება, მაგრამ top/left მას აწევს.", en: "Stays in place, but top/left nudge it." },
  absolute: { ka: "ნაკადიდან ამოდის და უახლოეს positioned მშობელთან თავსდება.", en: "Leaves the flow and is placed against the nearest positioned parent." },
  column: { ka: "ზემოდან ქვემოთ.", en: "Top to bottom." },
  row: { ka: "მარცხნიდან მარჯვნივ.", en: "Left to right." },
};

export const PSEUDO: Record<string, Text> = {
  hover: { ka: "როცა მაუსი ელემენტზეა.", en: "While the mouse is over the element." },
  active: { ka: "როცა ელემენტზე აჭერენ.", en: "While the element is being pressed." },
  focus: { ka: "როცა ელემენტი არჩეულია (მაგ. ველი, რომელშიც წერენ).", en: "When the element is selected, e.g. a field being typed in." },
  "first-child": { ka: "მხოლოდ პირველი შვილი.", en: "Only the first child." },
  "last-child": { ka: "მხოლოდ ბოლო შვილი.", en: "Only the last child." },
  "nth-child": { ka: "შვილი თავისი ნომრით, მაგ. :nth-child(2).", en: "A child by its number, e.g. :nth-child(2)." },
  visited: { ka: "ბმული, რომელზეც უკვე გადახვედი.", en: "A link you have already visited." },
};

export function pick(text: Text, locale: Locale): string {
  return text[locale];
}
