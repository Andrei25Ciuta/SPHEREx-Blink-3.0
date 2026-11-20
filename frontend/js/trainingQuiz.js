import { LEVELS, gradeAnswer } from "./features/learning.js";

const slugs = ["spherex", "stars", "galaxies", "blink", "proper-motion", "parallax",
  "brown-dwarfs", "noise", "coordinates", "redshift"];
export const THEORY_QUESTIONS = slugs.map((slug) => LEVELS.find((level) => level.slug === slug));

function setupQuiz() {
  const prompt = document.getElementById("theory-prompt");
  const progress = document.getElementById("theory-progress");
  const answers = document.getElementById("theory-answers");
  const feedback = document.getElementById("theory-feedback");
  const next = document.getElementById("theory-next");
  const total = THEORY_QUESTIONS.length;
  let index = -1;
  let score = 0;

  function showQuestion() {
    const level = THEORY_QUESTIONS[index];
    progress.textContent = `Question ${index + 1} of ${total}`;
    prompt.textContent = level.quiz.prompt;
    feedback.textContent = "";
    next.hidden = true;
    const buttons = level.quiz.choices.map(({ id, label }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = label;
      button.addEventListener("click", () => {
        if (button.disabled) return;
        const { correct } = gradeAnswer(level.id, id);
        if (correct) score++;
        buttons.forEach((choice, choiceIndex) => {
          choice.disabled = true;
          choice.toggleAttribute("data-correct", level.quiz.choices[choiceIndex].id === level.quiz.answer);
        });
        button.toggleAttribute("data-incorrect", !correct);
        const expected = level.quiz.choices.find((choice) => choice.id === level.quiz.answer);
        feedback.textContent = correct ? "Correct." : `Correct answer: ${expected.label}`;
        next.textContent = index + 1 === total ? "See results" : "Next question";
        next.hidden = false;
        next.focus({ preventScroll: true });
      });
      return button;
    });
    answers.replaceChildren(...buttons);
    prompt.focus();
  }

  next.addEventListener("click", () => {
    if (index === total) {
      index = -1;
      score = 0;
    }
    index++;
    if (index < total) {
      showQuestion();
      return;
    }
    progress.textContent = "";
    answers.replaceChildren();
    prompt.textContent = `Final score: ${score}/${total}`;
    feedback.textContent = "Quiz complete.";
    next.textContent = "Play again";
    prompt.focus();
  });
}

if (typeof document !== "undefined") setupQuiz();
