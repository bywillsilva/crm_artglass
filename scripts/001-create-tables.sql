-- Criação das tabelas do CRM
-- Executar no banco de dados u244612010_crm

-- Tabela de Usuários
CREATE TABLE IF NOT EXISTS usuarios (
  id VARCHAR(36) PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  senha VARCHAR(255) NOT NULL,
  avatar VARCHAR(10),
  role ENUM('admin', 'gerente', 'vendedor') NOT NULL DEFAULT 'vendedor',
  ativo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Tabela de Clientes
CREATE TABLE IF NOT EXISTS clientes (
  id VARCHAR(36) PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  telefone VARCHAR(20),
  empresa VARCHAR(255),
  cargo VARCHAR(255),
  endereco TEXT,
  cidade VARCHAR(100),
  estado VARCHAR(2),
  cep VARCHAR(10),
  origem ENUM('site', 'indicacao', 'google', 'facebook', 'instagram', 'telefone', 'outro') DEFAULT 'site',
  status_funil ENUM('lead_novo', 'em_atendimento', 'orcamento_enviado', 'negociacao', 'fechado', 'perdido') DEFAULT 'lead_novo',
  valor_potencial DECIMAL(15, 2) DEFAULT 0,
  responsavel_id VARCHAR(36),
  observacoes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (responsavel_id) REFERENCES usuarios(id) ON DELETE SET NULL
);

-- Tabela de Tarefas
CREATE TABLE IF NOT EXISTS tarefas (
  id VARCHAR(36) PRIMARY KEY,
  titulo VARCHAR(255) NOT NULL,
  descricao TEXT,
  tipo ENUM('ligacao', 'email', 'reuniao', 'visita', 'outro') NOT NULL,
  data_hora DATETIME NOT NULL,
  status ENUM('pendente', 'concluida', 'atrasada', 'cancelada') DEFAULT 'pendente',
  cliente_id VARCHAR(36) NOT NULL,
  responsavel_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
  FOREIGN KEY (responsavel_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Tabela de Propostas
CREATE TABLE IF NOT EXISTS propostas (
  id VARCHAR(36) PRIMARY KEY,
  numero VARCHAR(50) NOT NULL UNIQUE,
  cliente_id VARCHAR(36) NOT NULL,
  responsavel_id VARCHAR(36) NOT NULL,
  titulo VARCHAR(255) NOT NULL,
  descricao TEXT,
  valor DECIMAL(15, 2) NOT NULL,
  desconto DECIMAL(5, 2) DEFAULT 0,
  valor_final DECIMAL(15, 2) NOT NULL,
  status ENUM('rascunho', 'enviada', 'em_analise', 'aprovada', 'rejeitada', 'expirada') DEFAULT 'rascunho',
  validade DATE,
  servicos JSON,
  condicoes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
  FOREIGN KEY (responsavel_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Tabela de Interações/Histórico
CREATE TABLE IF NOT EXISTS interacoes (
  id VARCHAR(36) PRIMARY KEY,
  cliente_id VARCHAR(36) NOT NULL,
  usuario_id VARCHAR(36) NOT NULL,
  tipo ENUM('ligacao', 'email', 'reuniao', 'visita', 'nota', 'mudanca_status', 'proposta', 'tarefa') NOT NULL,
  descricao TEXT NOT NULL,
  dados JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Tabela de Configurações
CREATE TABLE IF NOT EXISTS configuracoes (
  id VARCHAR(36) PRIMARY KEY,
  chave VARCHAR(100) NOT NULL UNIQUE,
  valor JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Índices para melhor performance
CREATE INDEX idx_clientes_status ON clientes(status_funil);
CREATE INDEX idx_clientes_responsavel ON clientes(responsavel_id);
CREATE INDEX idx_tarefas_status ON tarefas(status);
CREATE INDEX idx_tarefas_data ON tarefas(data_hora);
CREATE INDEX idx_tarefas_cliente ON tarefas(cliente_id);
CREATE INDEX idx_propostas_status ON propostas(status);
CREATE INDEX idx_propostas_cliente ON propostas(cliente_id);
CREATE INDEX idx_interacoes_cliente ON interacoes(cliente_id);
CREATE INDEX idx_interacoes_data ON interacoes(created_at);
