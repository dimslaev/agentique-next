client<llm> Fast {
  provider openai-generic
  options {
    base_url "https://integrate.api.nvidia.com/v1"
    api_key env.NVIDIA_NIM_API_KEY
    model "qwen/qwen3-next-80b-a3b-instruct"
    timeout 60
  }
}

client<llm> Nvidia {
  provider openai-generic
  options {
    base_url "https://integrate.api.nvidia.com/v1"
    api_key env.NVIDIA_NIM_API_KEY
    model "moonshotai/kimi-k2.6"
    timeout 60
  }
}

client<llm> NvidiaGptOss {
  provider openai-generic
  options {
    base_url "https://integrate.api.nvidia.com/v1"
    api_key env.NVIDIA_NIM_API_KEY
    model "openai/gpt-oss-120b"
    timeout 60
  }
}
