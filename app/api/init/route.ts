import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { query } from '@/lib/db/mysql'

export async function POST() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id VARCHAR(36) PRIMARY KEY,
        nome VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        senha VARCHAR(255) NOT NULL,
        avatar VARCHAR(10),
        role ENUM('admin', 'gerente', 'vendedor', 'orcamentista') NOT NULL DEFAULT 'vendedor',
        ativo BOOLEAN DEFAULT TRUE,
        meta_vendas DECIMAL(15, 2) NOT NULL DEFAULT 0,
        module_permissions JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `)

    await query(`
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
        origem ENUM('site', 'indicacao', 'google', 'facebook', 'instagram', 'telefone', 'outro') NULL DEFAULT NULL,
        status_funil ENUM('lead_novo', 'em_atendimento', 'orcamento_enviado', 'negociacao', 'fechado', 'perdido') DEFAULT 'lead_novo',
        valor_potencial DECIMAL(15, 2) DEFAULT 0,
        observacoes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS tarefas (
        id VARCHAR(36) PRIMARY KEY,
        titulo VARCHAR(255) NOT NULL,
        descricao TEXT,
        tipo ENUM('ligacao', 'email', 'reuniao', 'visita', 'outro') NOT NULL,
        data_hora DATETIME NOT NULL,
        status ENUM('pendente', 'concluida', 'atrasada', 'cancelada') DEFAULT 'pendente',
        cliente_id VARCHAR(36) NOT NULL,
        responsavel_id VARCHAR(36) NOT NULL,
        proposta_id VARCHAR(36) NULL,
        automacao_etapa VARCHAR(50) NULL,
        origem VARCHAR(30) NOT NULL DEFAULT 'manual',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS propostas (
        id VARCHAR(36) PRIMARY KEY,
        numero VARCHAR(50) NOT NULL UNIQUE,
        cliente_id VARCHAR(36) NOT NULL,
        responsavel_id VARCHAR(36) NOT NULL,
        orcamentista_id VARCHAR(36) NULL,
        retificacoes_count INT NOT NULL DEFAULT 0,
        titulo VARCHAR(255) NOT NULL,
        descricao TEXT,
        valor DECIMAL(15, 2) NOT NULL,
        desconto DECIMAL(5, 2) DEFAULT 0,
        valor_final DECIMAL(15, 2) NOT NULL,
        status ENUM(
          'novo_cliente',
          'em_orcamento',
          'aguardando_aprovacao',
          'enviar_ao_cliente',
          'enviado_ao_cliente',
          'follow_up_1_dia',
          'aguardando_follow_up_3_dias',
          'follow_up_3_dias',
          'aguardando_follow_up_7_dias',
          'follow_up_7_dias',
          'stand_by',
          'em_retificacao',
          'fechado',
          'perdido'
        ) DEFAULT 'novo_cliente',
        validade DATE,
        servicos JSON,
        condicoes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS proposal_sequences (
        ano INT PRIMARY KEY,
        ultimo_numero INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS proposta_anexos (
        id VARCHAR(36) PRIMARY KEY,
        proposta_id VARCHAR(36) NOT NULL,
        nome_original VARCHAR(255) NOT NULL,
        nome_arquivo VARCHAR(255) NOT NULL,
        caminho VARCHAR(500) NOT NULL,
        tipo_mime VARCHAR(150) NOT NULL,
        tamanho BIGINT NOT NULL DEFAULT 0,
        usuario_id VARCHAR(36) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS proposta_comentarios (
        id VARCHAR(36) PRIMARY KEY,
        proposta_id VARCHAR(36) NOT NULL,
        usuario_id VARCHAR(36) NOT NULL,
        comentario TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS interacoes (
        id VARCHAR(36) PRIMARY KEY,
        cliente_id VARCHAR(36) NOT NULL,
        usuario_id VARCHAR(36) NOT NULL,
        tipo ENUM('ligacao', 'email', 'reuniao', 'visita', 'nota', 'mudanca_status', 'proposta', 'tarefa') NOT NULL,
        descricao TEXT NOT NULL,
        dados JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS configuracoes (
        id VARCHAR(36) PRIMARY KEY,
        chave VARCHAR(100) NOT NULL,
        scope VARCHAR(20) NOT NULL DEFAULT 'global',
        user_id VARCHAR(36) NOT NULL DEFAULT '',
        valor JSON NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_config_scope (chave, scope, user_id)
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id VARCHAR(36) PRIMARY KEY,
        usuario_id VARCHAR(36) NOT NULL,
        email VARCHAR(255) NOT NULL,
        token_hash VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id VARCHAR(36) PRIMARY KEY,
        nome VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        senha_hash VARCHAR(255) NOT NULL,
        token_hash VARCHAR(255) NOT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS notification_reads (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        notification_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_notification (user_id, notification_id)
      )
    `)

    await query(`
      CREATE TABLE IF NOT EXISTS realtime_updates (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        actor_user_id VARCHAR(36) NULL,
        resource VARCHAR(50) NOT NULL,
        resource_id VARCHAR(64) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY idx_realtime_updates_created_id (created_at, id)
      )
    `)

    const usuarios = await query<any[]>('SELECT COUNT(*) as total FROM usuarios')

    if (usuarios[0].total === 0) {
      const initialUsersPassword = process.env.INITIAL_USERS_PASSWORD

      if (!initialUsersPassword || initialUsersPassword.trim().length < 8) {
        return NextResponse.json(
          {
            error: 'Defina a variavel INITIAL_USERS_PASSWORD com no minimo 8 caracteres antes de inicializar os usuarios',
          },
          { status: 400 }
        )
      }

      const senhaHash = await bcrypt.hash(initialUsersPassword, 10)

      await query(
        `INSERT INTO usuarios (id, nome, email, senha, avatar, role, ativo) VALUES
         ('user-1', 'Carlos Silva', 'carlos@solartech.com', ?, 'CS', 'admin', TRUE),
         ('user-2', 'Ana Oliveira', 'ana@solartech.com', ?, 'AO', 'gerente', TRUE),
         ('user-3', 'Pedro Santos', 'pedro@solartech.com', ?, 'PS', 'vendedor', TRUE),
         ('user-4', 'Maria Costa', 'maria@solartech.com', ?, 'MC', 'vendedor', TRUE),
         ('user-5', 'Joao Ferreira', 'joao@solartech.com', ?, 'JF', 'vendedor', FALSE),
         ('user-6', 'Bruno Rocha', 'bruno@solartech.com', ?, 'BR', 'orcamentista', TRUE)`,
        [senhaHash, senhaHash, senhaHash, senhaHash, senhaHash, senhaHash]
      )

      await query(`
        INSERT INTO clientes (id, nome, email, telefone, empresa, cargo, cidade, estado, origem, status_funil, valor_potencial, observacoes) VALUES
        ('cli-1', 'Roberto Mendes', 'roberto@industria.com', '(11) 99999-1111', 'Industria ABC', 'Diretor', 'Sao Paulo', 'SP', 'site', 'negociacao', 85000.00, 'Cliente interessado em sistema de 50kWp para industria'),
        ('cli-2', 'Fernanda Lima', 'fernanda@comercio.com', '(11) 99999-2222', 'Comercio XYZ', 'Gerente', 'Campinas', 'SP', 'indicacao', 'orcamento_enviado', 32000.00, 'Indicacao do cliente Roberto'),
        ('cli-3', 'Marcelo Souza', 'marcelo@fazenda.com', '(19) 99999-3333', 'Fazenda Sol Nascente', 'Proprietario', 'Ribeirao Preto', 'SP', 'google', 'em_atendimento', 120000.00, 'Interessado em sistema rural de grande porte'),
        ('cli-4', 'Patricia Alves', 'patricia@residencial.com', '(11) 99999-4444', NULL, NULL, 'Santos', 'SP', 'facebook', 'lead_novo', 15000.00, 'Residencia com alto consumo mensal'),
        ('cli-5', 'Ricardo Gomes', 'ricardo@hotel.com', '(13) 99999-5555', 'Hotel Praia Azul', 'Administrador', 'Guaruja', 'SP', 'instagram', 'fechado', 95000.00, 'Projeto concluido - sistema de 80kWp'),
        ('cli-6', 'Amanda Ferreira', 'amanda@escola.com', '(11) 99999-6666', 'Colegio Educar', 'Diretora', 'Sao Bernardo', 'SP', 'telefone', 'negociacao', 45000.00, 'Escola particular interessada em energia solar')
      `)

      await query(`
        INSERT INTO tarefas (id, titulo, descricao, tipo, data_hora, status, cliente_id, responsavel_id, origem) VALUES
        ('task-1', 'Ligar para Roberto', 'Verificar interesse na proposta enviada', 'ligacao', NOW(), 'pendente', 'cli-1', 'user-3', 'manual'),
        ('task-2', 'Enviar proposta para Fernanda', 'Preparar e enviar proposta comercial', 'email', DATE_ADD(NOW(), INTERVAL 1 HOUR), 'pendente', 'cli-2', 'user-3', 'manual'),
        ('task-3', 'Visita tecnica - Fazenda', 'Realizar visita tecnica para dimensionamento', 'visita', DATE_ADD(NOW(), INTERVAL 1 DAY), 'pendente', 'cli-3', 'user-4', 'manual'),
        ('task-4', 'Retornar ligacao Patricia', 'Cliente solicitou mais informacoes', 'ligacao', DATE_SUB(NOW(), INTERVAL 1 DAY), 'atrasada', 'cli-4', 'user-4', 'manual')
      `)

      await query(`
        INSERT INTO propostas (id, numero, cliente_id, responsavel_id, orcamentista_id, titulo, descricao, valor, desconto, valor_final, status, validade, servicos) VALUES
        ('prop-1', 'PROP-2026-001', 'cli-1', 'user-3', 'user-6', 'Sistema Fotovoltaico 50kWp', 'Sistema completo para industria com monitoramento', 90000.00, 5.56, 85000.00, 'enviado_ao_cliente', DATE_ADD(CURDATE(), INTERVAL 30 DAY), '["Paineis solares 550W (91 unidades)", "Inversor string 50kW", "Estrutura de fixacao", "Instalacao completa", "Monitoramento remoto", "Garantia 25 anos"]'),
        ('prop-2', 'PROP-2026-002', 'cli-2', 'user-3', 'user-6', 'Sistema Fotovoltaico 12kWp', 'Sistema para comercio de medio porte', 35000.00, 8.57, 32000.00, 'follow_up_1_dia', DATE_ADD(CURDATE(), INTERVAL 15 DAY), '["Paineis solares 550W (22 unidades)", "Inversor string 12kW", "Estrutura de fixacao", "Instalacao completa", "Garantia 25 anos"]'),
        ('prop-3', 'PROP-2026-003', 'cli-5', 'user-3', 'user-6', 'Sistema Fotovoltaico 80kWp', 'Sistema de grande porte para hotel', 100000.00, 5.00, 95000.00, 'fechado', DATE_SUB(CURDATE(), INTERVAL 30 DAY), '["Paineis solares 550W (146 unidades)", "Inversores string", "Estrutura completa", "Instalacao", "Monitoramento", "Manutencao 2 anos"]'),
        ('prop-4', 'PROP-2026-004', 'cli-6', 'user-4', 'user-6', 'Sistema Fotovoltaico 18kWp', 'Sistema para instituicao de ensino', 48000.00, 6.25, 45000.00, 'em_orcamento', DATE_ADD(CURDATE(), INTERVAL 20 DAY), '["Paineis solares 550W (33 unidades)", "Inversor string 20kW", "Estrutura de fixacao", "Instalacao completa", "Garantia 25 anos"]')
      `)

      await query(`
        INSERT INTO configuracoes (id, chave, scope, user_id, valor) VALUES
        ('conf-1', 'empresa', 'global', '', '{"nome": "SolarTech Energia", "cnpj": "12.345.678/0001-90", "telefone": "(11) 3333-4444", "email": "contato@solartech.com", "endereco": "Av. Paulista, 1000", "cidade": "Sao Paulo", "estado": "SP", "cep": "01310-100"}'),
        ('conf-2', 'funil', 'global', '', '{"etapas": ["novo_cliente", "em_orcamento", "em_retificacao", "aguardando_aprovacao", "enviar_ao_cliente", "enviado_ao_cliente", "follow_up_1_dia", "follow_up_3_dias", "follow_up_7_dias", "stand_by", "fechado", "perdido"]}')
      `)
    }

    return NextResponse.json({ success: true, message: 'Banco de dados inicializado com sucesso' })
  } catch (error) {
    console.error('Erro ao inicializar banco de dados:', error)
    return NextResponse.json({ error: 'Erro ao inicializar banco de dados', details: String(error) }, { status: 500 })
  }
}

export async function GET() {
  try {
    const [usuarios] = await query<any[]>('SELECT COUNT(*) as total FROM usuarios')
    const [clientes] = await query<any[]>('SELECT COUNT(*) as total FROM clientes')
    const [tarefas] = await query<any[]>('SELECT COUNT(*) as total FROM tarefas')
    const [propostas] = await query<any[]>('SELECT COUNT(*) as total FROM propostas')

    return NextResponse.json({
      connected: true,
      tables: {
        usuarios: usuarios.total,
        clientes: clientes.total,
        tarefas: tarefas.total,
        propostas: propostas.total,
      },
    })
  } catch (error) {
    return NextResponse.json({ connected: false, error: String(error) }, { status: 500 })
  }
}
