declare module "*.astro" {
  const component: Parameters<
    import("astro/container").experimental_AstroContainer["renderToResponse"]
  >[0];
  export default component;
}
