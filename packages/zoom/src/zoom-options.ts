/** The option and metadata types of the Zoom provider, for type checking in `calsdk`. */
export type ZoomProviderTypes = {
  options: Record<never, never>;
  eventMetadata: ZoomEventMetadata;
};

/** `providerMetadata.zoom` on events. The event id is the meeting id. */
export type ZoomEventMetadata = {
  /** The meeting's uuid, which Zoom uses for past meetings and recordings. */
  uuid?: string;
  /** For an occurrence of a series, Zoom's `occurrence_id`. */
  occurrenceId?: string;
};
