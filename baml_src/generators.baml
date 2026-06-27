generator typescript {
  output_type "typescript"
  output_dir "../"
  version "0.223.0"
  default_client_mode "async"
}

generator python {
  output_type "python/pydantic"
  output_dir "../backend/"
  version "0.223.0"
}
