import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  { ignores: ["public/assets/**"] },
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // Modules start asynchronous, database-backed loads from effects.
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default config;
