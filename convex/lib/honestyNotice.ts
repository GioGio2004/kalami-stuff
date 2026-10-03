/**
 * The honesty notice students accept during onboarding. Bump `version` whenever the
 * substance changes: everyone is then asked to accept the new text.
 * Draft wording; have it reviewed against the Georgian personal data law before the pilot.
 */
export const HONESTY_NOTICE = {
  version: 1,
  ka: {
    title: "კეთილსინდისიერების შეტყობინება",
    intro:
      "კალამი ერთ წესზეა აგებული: თქვენი ნამუშევარი თქვენივე ხელით იწერება. რომ ეს ყველასთვის სამართლიანი იყოს, სწავლისა და შეფასებების დროს ზოგიერთი აქტივობა იზომება. აქ ზუსტად წერია, რა და რატომ.",
    sections: [
      {
        heading: "რას ვზომავთ",
        items: [
          "გაკვეთილებზე დახარჯულ დროს — მხოლოდ მაშინ, როცა გვერდი გახსნილია და აქტიური ხართ.",
          "დავალებების, ქვიზებისა და გამოცდების დროს: ჩანართიდან ან ფანჯრიდან გასვლას, სრული ეკრანის რეჟიმიდან გამოსვლას და იმას, თუ რამდენ ხანს იყავით გასული.",
          "ტექსტის ჩასმის, კოპირებისა და გადმოტანის დაბლოკილ მცდელობებს, ასევე ტექსტის უჩვეულოდ დიდ ან სწრაფ ჩამატებას.",
          "გახსნილია თუ არა იგივე ანგარიში მეორე ჩანართში ან სხვა მოწყობილობაზე.",
        ],
      },
      {
        heading: "რას არასდროს ვიწერთ",
        items: [
          "თქვენს ეკრანს, კამერას ან მიკროფონს.",
          "ცალკეულ კლავიშებზე დაჭერას ან რაიმეს კალამის გარეთ.",
        ],
      },
      {
        heading: "ვინ ხედავს ამ მონაცემებს",
        items: [
          "თქვენი ლექტორი (და კურსის ასისტენტები) — მხოლოდ იმ კურსებზე, რომლებზეც ჩარიცხული ხართ.",
          "საკუთარ აქტივობას თქვენც ხედავთ პროფილში.",
          "მონიშვნა რჩევაა და არა განაჩენი: გადაწყვეტილებას ყოველთვის ადამიანი იღებს და არა სისტემა.",
        ],
      },
      {
        heading: "რამდენ ხანს ინახება",
        items: [
          "დეტალური ჩანაწერები სემესტრის ბოლოს არქივდება და იშლება უნივერსიტეტთან შეთანხმებული ვადის გასვლის შემდეგ.",
        ],
      },
    ],
  },
  en: {
    title: "Honesty notice",
    intro:
      "Kalami is built on one rule: your work is written by your own hand. To keep that fair for everyone, some activity is measured while you study and take assessments. Here is exactly what, and why.",
    sections: [
      {
        heading: "What we measure",
        items: [
          "Time spent on lessons, counted only while the page is open and you are active.",
          "During tasks, quizzes and exams: leaving the tab or window, leaving fullscreen, and how long you were away.",
          "Blocked paste, copy and drop attempts, and unusually large or fast insertions of text.",
          "Whether the same account is open in a second tab or on another device.",
        ],
      },
      {
        heading: "What we never record",
        items: [
          "Your screen, camera or microphone.",
          "Individual keystrokes, or anything outside Kalami.",
        ],
      },
      {
        heading: "Who sees it",
        items: [
          "Your lecturer (and course assistants), only for courses you are enrolled in.",
          "You can see your own activity on your profile.",
          "A flag is advice, not a verdict: a person always decides, never the system.",
        ],
      },
      {
        heading: "How long it is kept",
        items: [
          "Detailed records are archived at the end of the semester and deleted after the period agreed with your university.",
        ],
      },
    ],
  },
};
