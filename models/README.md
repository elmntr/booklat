# Speech model

Download **whisper-medium-ph-ct2-int8.zip** and **SHA256SUMS** from the
[speech-model-v1 release](https://github.com/elmntr/booklat/releases/tag/speech-model-v1).
The archive contains the prepared CTranslate2 int8 model for CPU inference, its
license, upstream model card, and conversion details.

Verify the ZIP against SHA256SUMS, then extract it into this directory. The model
must appear at `models/whisper-medium-ph-ct2/model.bin`, with its four JSON files
alongside it. Avoid an extra nested folder. From the repository root, run:

```sh
npm run dev:speech
```

On Linux, if both downloaded files are in your Downloads folder:

```sh
cd ~/Downloads
sha256sum --check SHA256SUMS
```

Extract with your archive manager after the checksum passes. If a model folder
already exists, use it or move it aside before extracting the release.

The runtime needs about 739 MiB of model files. Downloading this prepared model
avoids the larger source download and local conversion. Dependencies still need
installation on the first run; subsequent inference works offline.

Source: [rbcurzon/whisper-medium-ph](https://huggingface.co/rbcurzon/whisper-medium-ph),
weights revision `78c8f3e722ed5409eeb7c0b205bb3bf370cc19f5`. The upstream model card
declares Apache-2.0. Booklat converts the weights without further training.
To reproduce the conversion, run `npm run speech:setup` without an existing model.

Git ignores downloaded models and source caches here. The large ZIP is a GitHub
Release asset; cloning the repository alone does not download it.
