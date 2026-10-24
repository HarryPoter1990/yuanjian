declare module 'virtual:yuanjian-graph' {
  export function loadGraphModule(attempt?: number): Promise<{
    GraphView: import('react').ComponentType<
      Omit<
        import('react').ComponentProps<typeof import('./components/GraphView').GraphView>,
        'engine'
      >
    >;
  }>;
}
